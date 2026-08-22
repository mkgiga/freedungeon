import { z } from 'zod'
import { router, procedure } from '../../trpc'
import { db, hydrateNotification } from '../../db'
import { markNotificationsSeen } from '../../notifications'

export const notificationsRouter = router({
    /**
     * A page of notification history, newest first.
     *
     * Queried rather than replicated: the log is unbounded, so it must not ride
     * along in app state. `before` is a createdAt cursor rather than an offset,
     * so an arrival mid-scroll cannot shift the page under the reader.
     */
    list: procedure
        .input(z.object({
            before: z.number().optional(),
            limit: z.number().int().min(1).max(100).default(50),
        }))
        .query(async ({ input }) => {
            let q = db.selectFrom('notifications')
                .selectAll()
                // Diagnostic entries stay out of the user-facing list: they are
                // recorded for support, not for reading.
                .where('show', '=', 1)
                .orderBy('created_at', 'desc')
                .limit(input.limit)
            if (input.before !== undefined) q = q.where('created_at', '<', input.before)
            return (await q.execute()).map(hydrateNotification)
        }),

    /** Clear the unseen badge wholesale. */
    markSeen: procedure.mutation(() => {
        markNotificationsSeen()
        return { success: true }
    }),
})
