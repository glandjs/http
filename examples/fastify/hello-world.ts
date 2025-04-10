import { Controller, Module } from '@glandjs/common'
import { Get } from '@glandjs/http'
import { GlandFactory } from '@glandjs/core'
import { FastifyBroker, type FastifyContext } from '@glandjs/fastify'
@Controller('/')
class UserController {
  @Get()
  index(ctx: FastifyContext) {
    ctx.res.send('Hello World')
  }
}

@Module({
  controllers: [UserController],
})
class AppModule {}

async function bootstrap() {
  const app = await GlandFactory.create(AppModule)
  const fastify = app.connectTo(FastifyBroker)
  await fastify.listen(3000)
}
bootstrap()
