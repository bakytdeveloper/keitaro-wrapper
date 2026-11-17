export class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
  }
}

export class KeitaroError extends Error {
  constructor(status, detail, path) {
    super(`Keitaro ${status} on ${path}: ${detail}`);
    this.name = "KeitaroError";
    this.status = status;
    this.detail = detail;
    this.path = path;
  }
}
