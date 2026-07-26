/**
 * Copyright (c) 2026 hangtiancheng
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const binding = require("../build/Release/glob_addon.node") as {
	globMatch: (pattern: string, text: string) => boolean;
	globScan: (
		pattern: string,
		cwd: string | null,
		excludeDirs: string[] | null,
		dot: boolean | null,
		maxResults: number | null,
	) => string[];
};

export interface GlobScanOptions {
	cwd?: string;
	exclude?: string[];
	dot?: boolean;
	maxResults?: number;
}

export interface GlobOptions {
	dot?: boolean;
}

export class Glob {
	readonly pattern: string;
	readonly dot: boolean;

	constructor(pattern: string, options?: GlobOptions) {
		this.pattern = pattern;
		this.dot = options?.dot ?? false;
	}

	match(text: string): boolean {
		return binding.globMatch(this.pattern, text);
	}

	scan(options?: GlobScanOptions): string[] {
		return binding.globScan(
			this.pattern,
			options?.cwd ?? null,
			options?.exclude ?? null,
			options?.dot ?? this.dot ?? null,
			options?.maxResults ?? null,
		);
	}
}
