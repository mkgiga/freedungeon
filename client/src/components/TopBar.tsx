import { Show, type JSXElement } from "solid-js";
import { useRouter } from "@tanstack/solid-router";
import { Toolbar } from "./Toolbar";
import { MdFillArrow_back } from "solid-icons/md";
import { Heading } from "./typography/Heading";

export type TopBarProps = {
    title: string;
    height?: string;
    slots?: {
        left?: JSXElement;
        center?: JSXElement;
        right?: JSXElement;
    };
    backButton?: boolean | (() => void);
};

export const TopBar = (props: TopBarProps) => {
    const router = useRouter();
    const onBack = () => {
        if (typeof props.backButton === 'function') props.backButton();
        else router.history.back();
    };
    const leftSlot = <>
        <Show when={props.backButton}>
            <button onClick={onBack}>
                <MdFillArrow_back size={24} />
            </button>
        </Show>
        <Heading level={1} class={`text-xl ${props.backButton ? '' : 'pl-4'}`}>{props.title}</Heading>
        {props.slots?.left}
    </>
    return (
        <Toolbar slots={{
            left: leftSlot,
            center: props.slots?.center,
            right: props.slots?.right
        }}
        height={props.height}/>
    );
};