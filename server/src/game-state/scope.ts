import type { GameStateContext } from '@shared/types';

export function createInitialContext(): GameStateContext {
    return { inventory: {}, hp: 100 };
}

export type ScopeBinding = { ctx: GameStateContext; arr: string[] };

export function createScope({ ctx, arr }: ScopeBinding) {
    return {
        unformatted: (_text: string) => {},
        text: (_text: string) => {},
        speech: (_actorId: string, _text: string, _opts?: object) => {},
        pause: (_seconds: number) => {},
        image: (_opts: object) => {},
        webview: (_html: string, _opts?: object) => {},
        noOpContinue: () => {},

        giveItem: (name: string, qty: number = 1) => {
            ctx.inventory[name] = (ctx.inventory[name] ?? 0) + qty;
            arr.push(`Received ${qty}x ${name}`);
        },
        takeItem: (name: string, qty: number = 1) => {
            const current = ctx.inventory[name] ?? 0;
            const taken = Math.min(current, qty);
            ctx.inventory[name] = current - taken;
            if (taken > 0) arr.push(`Lost ${taken}x ${name}`);
        },
        setHp: (value: number) => { ctx.hp = value; },
        damage: (amount: number) => {
            ctx.hp = Math.max(0, ctx.hp - amount);
            arr.push(`Took ${amount} damage (HP: ${ctx.hp})`);
        },
        heal: (amount: number) => {
            ctx.hp = ctx.hp + amount;
            arr.push(`Healed ${amount} (HP: ${ctx.hp})`);
        },
        attack: (_target: string) => {},
    } as const;
}
