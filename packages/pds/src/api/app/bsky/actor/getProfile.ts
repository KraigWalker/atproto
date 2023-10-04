import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import { authPassthru } from '../../../../api/com/atproto/admin/util'
import { OutputSchema } from '../../../../lexicon/types/app/bsky/actor/getProfile'
import { handleReadAfterWrite } from '../util/read-after-write'
import { LocalRecords } from '../../../../actor-store/local/reader'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.actor.getProfile({
    auth: ctx.accessOrRoleVerifier,
    handler: async ({ req, auth, params }) => {
      const requester =
        auth.credentials.type === 'access' ? auth.credentials.did : null
      const res = await ctx.appViewAgent.api.app.bsky.actor.getProfile(
        params,
        requester ? await ctx.serviceAuthHeaders(requester) : authPassthru(req),
      )
      if (res.data.did === requester) {
        return await handleReadAfterWrite(ctx, requester, res, getProfileMunge)
      }
      return {
        encoding: 'application/json',
        body: res.data,
      }
    },
  })
}

const getProfileMunge = async (
  ctx: AppContext,
  original: OutputSchema,
  local: LocalRecords,
  requester: string,
): Promise<OutputSchema> => {
  if (!local.profile) return original
  return ctx.actorStore
    .reader(requester)
    .local.updateProfileDetailed(original, local.profile.record)
}