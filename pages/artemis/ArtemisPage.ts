import { Page, expect } from "@playwright/test";
import dayjs from "dayjs";
import exerciseTemplate from "../../fixtures/utils/templates/exercise.json";
import courseTemplate from "../../fixtures/utils/templates/course.json";
import { v4 as uuidv4 } from "uuid";
import { ExercisePage } from "./ExercisePage";
import { courseName, exerciseName } from "../../fixtures/utils/constants";

/* eslint-disable  @typescript-eslint/no-explicit-any */

/**
 * Main IDE page class that composes all IDE components
 * Provides high-level operations that may involve multiple components
 */
export class ArtemisPage {
  readonly page: Page;
  readonly baseURL: string;
  readonly exercisePage: ExercisePage;

  constructor(page: Page, baseURL: string) {
    this.page = page;
    this.baseURL = baseURL;
  }

  /**
   * Custom goto method that appends the base URL to the path
   * @param path The relative path to the IDE URL
   */
  async goto(path: string) {
    await this.page.goto(this.baseURL + path);
  }

  /**
   * Logs in using API. (Most of this is copied from the Artemis Page Object Model)
   * @param user - Username of the user.
   * @param pwd - Password of the user.
   */
  async login(user: string, pwd: string): Promise<void> {
    const jwtCookie = await this.page
      .context()
      .cookies()
      .then((cookies) => cookies.find((cookie) => cookie.name === "jwt"));
    if (!jwtCookie) {
      const response = await this.page.request.post(
        this.baseURL + "/api/core/public/authenticate",
        {
          data: {
            username: user,
            password: pwd,
            rememberMe: true,
          },
          failOnStatusCode: false,
        },
      );

      expect(response.status()).toBe(200);

      const newJwtCookie = await this.page
        .context()
        .cookies()
        .then((cookies) => cookies.find((cookie) => cookie.name === "jwt"));
      expect(newJwtCookie).not.toBeNull();
    }
  }

  /**
   * Logs out using API.
   */
  async logout(): Promise<void> {
    await this.page.request.post(this.baseURL + "/api/core/public/logout");
  }

  /**
   * Creates a simple course with fixed values for testing purposes
   * @returns Promise<any> - The created course
   */
  async createSimpleCourse(): Promise<any> {
    const uuid = uuidv4().replace(/-/g, "").slice(0, 12);
    const course = {
      ...courseTemplate,
      title: "Theia Test Course " + uuid,
      shortName: courseName + uuid,
      startDate: dayjs().subtract(2, "hours"),
      endDate: dayjs().add(2, "hours"),
    };

    const multipart = {
      course: {
        name: "course",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(course)),
      },
    };

    const response = await this.page.request.post(
      this.baseURL + "/api/core/admin/courses",
      { multipart },
    );
    console.log(await response.json());
    expect(response.ok()).toBe(true);
    return response.json();
  }

  /**
   * Deletes a course with retry logic
   * @param courseId - ID of the course to delete
   * @returns Promise<void>
   */
  async deleteCourse(courseId: number): Promise<void> {
    // Sometimes the server fails with a ConstraintViolationError if we delete the course immediately after a login
    await this.page.waitForTimeout(500);

    // Retry in case of failures (with timeout in ms.)
    const timeout = 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const response = await this.page.request.delete(
        this.baseURL + "/api/core/admin/courses/" + courseId,
      );
      if (response.ok()) {
        console.log(`Course ${courseId} deleted successfully`);
        break;
      }
      console.log("Retrying delete course request due to failure");
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * Creates a Theia enabled exercise with fixed values for testing purposes
   * @returns Promise<any> - The created exercise
   */
  async createTheiaEnabledExercise(course: any): Promise<any> {
    const exercise = {
      ...exerciseTemplate,
      course: course,
      shortName: exerciseName,
      buildConfig: {
        theiaImage: "java-17",
      },
    };
    const response = await this.page.request.post(
      this.baseURL + `/api/programming/programming-exercises/setup`,
      { data: exercise },
    );
    console.log(await response.json());
    expect(response.ok()).toBe(true);
    return response.json();
  }
}
