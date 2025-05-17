import { Channel, On } from "@glandjs/common";
import type { ExpressContext } from "@glandjs/express";

@Channel("response")
export class Response {
  @On("send")
  index(ctx: ExpressContext) {
    ctx.send("Hello World");
  }
}
