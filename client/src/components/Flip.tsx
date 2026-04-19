import { children, createContext, createEffect, useContext, type JSX } from "solid-js";

type FlipProps = {
    horizontal?: boolean;
    vertical?: boolean;
    children: JSX.Element;
};

export const FlipContext = createContext({ horizontal: false, vertical: false });

export function useFlip() {
    return useContext(FlipContext);
}

const FlipApplier = (props: { transform: string; children: JSX.Element }) => {
    const resolved = children(() => props.children);

    createEffect(() => {
        const t = props.transform;
        for (const node of resolved.toArray()) {
            if (node instanceof HTMLElement) {
                node.style.transform = t;
            }
        }
    });

    return <>{resolved()}</>;
};

export const Flip = (props: FlipProps) => {
    const parent = useContext(FlipContext);

    const transform = () => {
        const h = props.horizontal, v = props.vertical;
        if (h && v) return 'scale(-1, -1)';
        if (h) return 'scaleX(-1)';
        if (v) return 'scaleY(-1)';
        return '';
    };

    const effH = () => Boolean(parent.horizontal) !== Boolean(props.horizontal);
    const effV = () => Boolean(parent.vertical) !== Boolean(props.vertical);

    return (
        <FlipContext.Provider value={{
            get horizontal() { return effH() },
            get vertical() { return effV() },
        }}>
            <FlipApplier transform={transform()}>
                {props.children}
            </FlipApplier>
        </FlipContext.Provider>
    );
};
