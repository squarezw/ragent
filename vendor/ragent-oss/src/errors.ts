export class RagentOssError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "RagentOssError";
  }
}

export class AuthenticationError extends RagentOssError {
  constructor(body: unknown) {
    super("Authentication failed", 401, body);
    this.name = "AuthenticationError";
  }
}

export class ValidationError extends RagentOssError {
  constructor(body: unknown) {
    super("Validation failed", 422, body);
    this.name = "ValidationError";
  }
}

export class UploadError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export class NetworkError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}
