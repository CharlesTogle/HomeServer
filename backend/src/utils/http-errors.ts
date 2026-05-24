export abstract class HttpError extends Error {
  public readonly statusCode: number;

  protected constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class BadRequestError extends HttpError {
  public constructor(message: string) {
    super(400, message);
  }
}

export class ConflictError extends HttpError {
  public constructor(message: string) {
    super(409, message);
  }
}

export class NotFoundError extends HttpError {
  public constructor(message: string) {
    super(404, message);
  }
}

export class UnauthorizedError extends HttpError {
  public constructor(message: string) {
    super(401, message);
  }
}
