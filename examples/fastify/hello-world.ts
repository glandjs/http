import { Controller, Module } from '@glandjs/common'
import { Get } from '@glandjs/http'
import { GlandFactory } from '@glandjs/core'
import { FastifyBroker, type FastifyContext } from '@glandjs/fastify'
import { Response } from '../response-send'
@Controller('/')
class UserController {
  @Get()
  index(ctx: FastifyContext) {
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
  const fastify = app.connectTo(FastifyBroker)
  await fastify.listen(3000)
}
bootstrap()
