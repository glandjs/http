import { Controller, Module, On } from '@glandjs/common'
import { Get } from '@glandjs/http'
import { GlandFactory } from '@glandjs/core'
import { ExpressBroker, type ExpressContext } from '@glandjs/express'
import { Response } from '../response-send'

@Controller('/')
class UserController {
  @Get()
  index(ctx: ExpressContext) {
    ctx.emit('@response:send', ctx)
  }
}

@Module({
  controllers: [UserController],
  channels: [Response],
})
class AppModule {}

async function bootstrap() {
  const app = await GlandFactory.create(AppModule)
  const express = app.connectTo(ExpressBroker)
  express.listen(3000)
}
bootstrap()
