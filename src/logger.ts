import type { Env } from "hono";
import pino, { type Logger, type LoggerOptions } from "pino";
import { config } from "./config.js";

export type AppEnv = Env & {
  Variables: {
    logger: Logger;
  };
};

const options: LoggerOptions = {
  level: config.log.level,
  base: { service: "broadside" },
  timestamp: pino.stdTimeFunctions.isoTime,
};

if (config.log.pretty) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  };
}

export const logger: Logger = pino(options);
