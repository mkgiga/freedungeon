import { customAlphabet } from "nanoid";

export const randomNumberId = (size?: number) => {
    const fn = customAlphabet('0123456789', size || 16);
    return parseInt(fn());
}