import { Timestamp } from '@bufbuild/protobuf'
import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.notification.updateSeen({
    auth: ctx.authVerifier.standard,
    handler: ctx.createHandler(async (ctx, { input }) => {
      const seenAt = new Date(input.body.seenAt)

      // For now we keep separate seen times behind the scenes for priority, but treat them as a single seen time.
      await Promise.all([
        ctx.dataplane.updateNotificationSeen({
          actorDid: ctx.viewer ?? undefined,
          timestamp: Timestamp.fromDate(seenAt),
          priority: false,
        }),
        ctx.dataplane.updateNotificationSeen({
          actorDid: ctx.viewer ?? undefined,
          timestamp: Timestamp.fromDate(seenAt),
          priority: true,
        }),
      ])
    }),
  })
}
