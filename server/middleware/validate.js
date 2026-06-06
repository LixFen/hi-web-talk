import { ZodError } from "zod";

export function validateBody(schema) {
  return (request, response, next) => {
    try {
      request.body = schema.parse(request.body ?? {});
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
        response.status(400).json({ error: messages.join("; ") });
        return;
      }
      next(error);
    }
  };
}

export function validateParams(schema) {
  return (request, response, next) => {
    try {
      request.params = schema.passthrough().parse(request.params ?? {});
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
        response.status(400).json({ error: messages.join("; ") });
        return;
      }
      next(error);
    }
  };
}

export function validateQuery(schema) {
  return (request, response, next) => {
    try {
      request.query = schema.parse(request.query ?? {});
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const messages = error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);
        response.status(400).json({ error: messages.join("; ") });
        return;
      }
      next(error);
    }
  };
}
