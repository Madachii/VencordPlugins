/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { RawGif } from "./types";

// props contain a useless .className we don't want
export function grabGifProp(e: React.UIEvent): RawGif | undefined {
    const node = e.currentTarget;
    const key = Object.keys(node).find(k => k.startsWith("__reactFiber$"));
    if (!key || !(key in node)) return;

    let fiber = node[key];
    while (fiber) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props) {
            const { src, url, format, width, height } = props;
            if (src && url && format && width && height) {
                return { src, url, format, width, height };
            }
        }
        fiber = fiber.return;
    }

    new Logger("GifFolders").error("Failed to find gif properties from fiber.");
}


export function searchProtoClassField(localName: string, protoClass: any) {
    const field = protoClass?.fields?.find((field: any) => field.localName === localName);
    if (!field) return;

    const fieldGetter = Object.values(field).find(value => typeof value === "function") as any;
    return fieldGetter?.();
}

export function cleanGif(gif: RawGif) {
    const cleaned = { ...gif, url: gif.url.split("?")[0] };
    return cleaned;
}
