import { Controller, Module } from '@glandjs/common'
import { Get } from '@glandjs/http'
import { GlandFactory } from '@glandjs/core'
import { ExpressBroker, type ExpressContext } from '@glandjs/express'

@Controller('/')
class UserController {
  @Get()
  index(ctx: ExpressContext) {
    ctx.res.send('Hello World')
  }
}

@Module({
  controllers: [UserController],
})
class AppModule {}

async function bootstrap() {
  const app = await GlandFactory.create(AppModule)
  const express = app.connectTo(ExpressBroker)
  express.listen(3000)
}
bootstrap()
