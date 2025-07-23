/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Gif } from "./gifStore";

export function grabGifProp(e: React.UIEvent): Gif | null {
    const node = e.currentTarget;
    const key = Object.keys(node).find(k => k.startsWith("__reactFiber$"));
    if (!key || !(key in node)) return null;

    let fiber = node[key];
    while (fiber) {
        const props = fiber.memoizedProps || fiber.pendingProps;
        if (props?.gif || (props?.src && props?.url)) {
            return props;
        }
        fiber = fiber.return;
    }
    return null;
}

export function searchProtoClassField(localName: string, protoClass: any) {
    const field = protoClass?.fields?.find((field: any) => field.localName === localName);
    if (!field) return;

    const fieldGetter = Object.values(field).find(value => typeof value === "function") as any;
    return fieldGetter?.();
}
