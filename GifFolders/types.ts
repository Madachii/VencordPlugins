/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Folder } from "./folders";
import { Gif } from "./gifStore";

export interface TrendingCategory {
    name: string;
    src: string;
    type: string;
    format: number;
}

export interface FolderPreviewGif {
    src: string;
    format: number;
}

export interface AddGifMenuResult {
    gifs?: Record<string, Gif>;
    folder?: Folder;
}

export type GifMap = Record<string, Gif>;

export interface GifImportOptions {
    importNew: boolean;
}
