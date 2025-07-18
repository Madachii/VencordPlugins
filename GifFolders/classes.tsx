/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Gif {
    url?: string,
    className: string,
    src: string,
    width: number,
    height: number,
    format: number,
    order: number,
}
export type GifMap = Record<string, Gif>;

export const DEFAULT_FOLDER_STEP = 10000;
export interface Folder {
    id: number;
    name: string;
    start: number;
    end: number;
}
