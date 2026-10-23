// Two parity fixes against Obsidian, pinned.
// 1. A link with folders ([[Requirements/OPEN-ITEMS]]) goes to the vault-root note first, as Obsidian does, even when
//    the linking note's own folder holds a copy at the same relative path.
// 2. The tag list is not cut off at 2,000 per collection (a large real vault has over 3,000 tags).
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolver} from '../lib.mjs';
import {readFileSync} from 'node:fs';

test('a path link resolves from the vault root before the linking note\'s folder', () => {
  const resolve = resolver(['Requirements/OPEN-ITEMS.md', 'Log/2026-10-03/snap/Requirements/OPEN-ITEMS.md', 'Log/2026-10-03/snap/00-HOME.md', 'Notes/Only-here/Plan.md']);
  assert.equal(resolve('Log/2026-10-03/snap/00-HOME.md', 'Requirements/OPEN-ITEMS'), 'Requirements/OPEN-ITEMS.md');
  // A relative path that has no vault-root match still resolves beside the note.
  assert.equal(resolve('Notes/Index.md', 'Only-here/Plan'), 'Notes/Only-here/Plan.md');
  // A bare name is unchanged: looked up by name.
  assert.equal(resolve('Notes/Index.md', 'Plan'), 'Notes/Only-here/Plan.md');
});

test('the tag list is not capped at 2,000', async () => {
  const {obsidianTagCounts} = await import('../vault-workspace.mjs');
  const many = Array.from({length: 3000}, (_, i) => 'tag' + i);
  assert.equal(Object.keys(obsidianTagCounts([many])).length, 3000);
  const sql = readFileSync(new URL('../queries.mjs', import.meta.url), 'utf8');
  const m = /\.slice\(0,(\d+)\)/.exec(sql.slice(sql.indexOf("kind==='tags'")));
  assert.ok(m && Number(m[1]) >= 10000, 'tag list limit');
});

test('digit-led tags are tags, as in Obsidian; all-digit ones are not', async () => {
  const {tagsOf} = await import('../vault-workspace.mjs');
  assert.deepEqual(tagsOf('a #1-3 b #2024 c #3d-print d #v2'), ['1-3', '3d-print', 'v2']);
  // Obsidian also lists these from a real vault: a slash and a symbol each count as a non-digit.
  assert.deepEqual(tagsOf('x #7/8 y #8/9/11 z #1→ w #2/1a'), ['7/8', '8/9/11', '1→', '2/1a']);
});

test('a link to a heading is not a tag, and a trailing slash is not part of one', async () => {
  const {tagsOf} = await import('../vault-workspace.mjs');
  // Measured against Obsidian 22 Oct: a # right after "(" is not a tag there, so (#real-tag) is skipped; a space-led one is kept.
  assert.deepEqual(tagsOf('See [setup](#1-core-server-configuration) and (#not-a-tag) and #real-tag and #folder/'), ['real-tag', 'folder']);
});
