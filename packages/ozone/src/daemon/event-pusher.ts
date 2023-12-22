import AtpAgent from '@atproto/api'
import { SECOND } from '@atproto/common'
import Database from '../db'
import { retryHttp } from '../util'
import { RepoPushEvent } from '../db/schema/repo_push_event'
import { RecordPushEvent } from '../db/schema/record_push_event'
import { BlobPushEvent } from '../db/schema/blob_push_event'
import { dbLogger } from '../logger'

type PollState = {
  timer?: NodeJS.Timer
  promise: Promise<void>
  tries: number
}

export class EventPusher {
  destroyed = false

  repoPollState: PollState = {
    promise: Promise.resolve(),
    tries: 0,
  }
  recordPollState: PollState = {
    promise: Promise.resolve(),
    tries: 0,
  }
  blobPollState: PollState = {
    promise: Promise.resolve(),
    tries: 0,
  }

  constructor(
    public db: Database,
    public appviewAgent: AtpAgent,
    public moderationPushAgent: AtpAgent,
  ) {}

  start() {
    this.poll(this.repoPollState, () => this.pushRepoEvents())
    this.poll(this.recordPollState, () => this.pushRecordEvents())
    this.poll(this.blobPollState, () => this.pushBlobEvents())
  }

  poll(state: PollState, fn: () => Promise<boolean>) {
    if (this.destroyed) return
    state.promise = fn()
      .then((hadEvts: boolean) => {
        if (hadEvts) {
          state.tries = 0
        } else {
          state.tries++
        }
      })
      .catch((err) => {
        dbLogger.error({ err }, 'event push failed')
        state.tries++
      })
      .finally(() => {
        state.timer = setTimeout(
          () => this.poll(state, fn),
          exponentialBackoff(state.tries),
        )
      })
  }

  async processAll() {
    await Promise.all([
      this.pushRepoEvents(),
      this.pushRecordEvents(),
      this.pushBlobEvents(),
    ])
  }

  async destroy() {
    this.destroyed = true
    const destroyState = (state: PollState) => {
      if (state.timer) {
        clearTimeout(state.timer)
      }
      return state.promise
    }
    await Promise.all([
      destroyState(this.repoPollState),
      destroyState(this.recordPollState),
      destroyState(this.blobPollState),
    ])
  }

  async pushRepoEvents() {
    return await this.db.transaction(async (dbTxn) => {
      const toPush = await dbTxn.db
        .selectFrom('repo_push_event')
        .selectAll()
        .forUpdate()
        .skipLocked()
        .where('confirmedAt', 'is', null)
        .execute()
      if (toPush.length === 0) return false
      await Promise.all(toPush.map((evt) => this.attemptRepoEvent(dbTxn, evt)))
      return true
    })
  }

  async pushRecordEvents() {
    return await this.db.transaction(async (dbTxn) => {
      const toPush = await dbTxn.db
        .selectFrom('record_push_event')
        .selectAll()
        .forUpdate()
        .skipLocked()
        .where('confirmedAt', 'is', null)
        .execute()
      if (toPush.length === 0) return false
      await Promise.all(
        toPush.map((evt) => this.attemptRecordEvent(dbTxn, evt)),
      )
      return true
    })
  }

  async pushBlobEvents() {
    return await this.db.transaction(async (dbTxn) => {
      const toPush = await dbTxn.db
        .selectFrom('blob_push_event')
        .selectAll()
        .forUpdate()
        .skipLocked()
        .where('confirmedAt', 'is', null)
        .execute()
      if (toPush.length === 0) return false
      await Promise.all(toPush.map((evt) => this.attemptBlobEvent(dbTxn, evt)))
      return true
    })
  }

  private async pushToBoth(
    fn: (agent: AtpAgent) => Promise<unknown>,
  ): Promise<boolean> {
    try {
      await Promise.all([
        retryHttp(() => fn(this.appviewAgent)),
        retryHttp(() => fn(this.moderationPushAgent)),
      ])
      return true
    } catch (err) {
      console.log(err)
      return false
    }
  }

  async attemptRepoEvent(txn: Database, evt: RepoPushEvent) {
    const succeeded = await this.pushToBoth((agent) =>
      agent.com.atproto.admin.updateSubjectStatus({
        subject: {
          $type: 'com.atproto.admin.defs#repoRef',
          did: evt.subjectDid,
        },
        takedown: {
          applied: !!evt.takedownId,
          ref: evt.takedownId?.toString(),
        },
      }),
    )
    if (succeeded) {
      await txn.db
        .updateTable('repo_push_event')
        .set({ confirmedAt: new Date() })
        .where('subjectDid', '=', evt.subjectDid)
        .where('eventType', '=', evt.eventType)
        .execute()
    } else {
      await txn.db
        .updateTable('repo_push_event')
        .set({
          lastAttempted: new Date(),
          attempts: evt.attempts ?? 0 + 1,
        })
        .where('subjectDid', '=', evt.subjectDid)
        .where('eventType', '=', evt.eventType)
        .execute()
    }
  }

  async attemptRecordEvent(txn: Database, evt: RecordPushEvent) {
    const succeeded = await this.pushToBoth((agent) =>
      agent.com.atproto.admin.updateSubjectStatus({
        subject: {
          $type: 'com.atproto.repo.strongRef',
          uri: evt.subjectUri,
          cid: evt.subjectCid,
        },
        takedown: {
          applied: !!evt.takedownId,
          ref: evt.takedownId?.toString(),
        },
      }),
    )
    if (succeeded) {
      await txn.db
        .updateTable('record_push_event')
        .set({ confirmedAt: new Date() })
        .where('subjectUri', '=', evt.subjectUri)
        .where('eventType', '=', evt.eventType)
        .execute()
    } else {
      await txn.db
        .updateTable('record_push_event')
        .set({
          lastAttempted: new Date(),
          attempts: evt.attempts ?? 0 + 1,
        })
        .where('subjectUri', '=', evt.subjectUri)
        .where('eventType', '=', evt.eventType)
        .execute()
    }
  }

  async attemptBlobEvent(txn: Database, evt: BlobPushEvent) {
    const succeeded = await this.pushToBoth((agent) =>
      agent.com.atproto.admin.updateSubjectStatus({
        subject: {
          $type: 'com.atproto.admin.defs#repoBlobRef',
          did: evt.subjectDid,
          cid: evt.subjectBlobCid,
        },
        takedown: {
          applied: !!evt.takedownId,
          ref: evt.takedownId?.toString(),
        },
      }),
    )
    if (succeeded) {
      await txn.db
        .updateTable('blob_push_event')
        .set({ confirmedAt: new Date() })
        .where('subjectDid', '=', evt.subjectDid)
        .where('subjectBlobCid', '=', evt.subjectBlobCid)
        .where('eventType', '=', evt.eventType)
        .execute()
    } else {
      await txn.db
        .updateTable('blob_push_event')
        .set({
          lastAttempted: new Date(),
          attempts: evt.attempts ?? 0 + 1,
        })
        .where('subjectDid', '=', evt.subjectDid)
        .where('subjectBlobCid', '=', evt.subjectBlobCid)
        .where('eventType', '=', evt.eventType)
        .execute()
    }
  }
}

const exponentialBackoff = (tries: number): number => {
  return Math.min(Math.pow(10, tries), 30 * SECOND)
}