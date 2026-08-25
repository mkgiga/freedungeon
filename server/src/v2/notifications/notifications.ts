import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { db, hydrateNotification } from '../../db'
import { markNotificationsSeen } from '../../notifications'

export const notificationsRouter = router({
    list: procedure
        .input(z.object({
            before: z.object({ createdAt: z.number(), id: z.string() }).optional(),
            limit: z.number().int().min(1).max(100).default(50),
        }))
        .query(async ({ input }) => {
            let q = db.selectFrom('notifications')
                .selectAll()
                // Diagnostic entries stay out of the user-facing list: they are
                // recorded for support, not for reading.
                .where('show', '=', 1)
                .orderBy('created_at', 'desc')
                .orderBy('id', 'desc')
                .limit(input.limit)
            const cursor = input.before
            if (cursor) {
                q = q.where((eb) => eb.or([
                    eb('created_at', '<', cursor.createdAt),
                    eb.and([eb('created_at', '=', cursor.createdAt), eb('id', '<', cursor.id)]),
                ]))
            }
            return (await q.execute()).map(hydrateNotification)
        }),

    markSeen: procedure.mutation(() => {
        markNotificationsSeen()
        return { success: true }
    }),
})
