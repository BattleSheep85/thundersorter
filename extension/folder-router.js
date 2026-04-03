/**
 * Folder router — tag-to-folder mapping and routing logic.
 */

/**
 * Given a message's tags and the user's mapping + priority order,
 * determine which folder the message should be moved to.
 *
 * Uses the tag priority waterfall: the highest-priority tag with a
 * folder mapping wins.
 *
 * @param {string[]} tags — tags assigned to the message
 * @param {object} mapping — { tagName: folderPath } or { tagName: folderId }
 * @param {string[]} priority — tag names in priority order (highest first)
 * @returns {string|null} — folder path/id or null if no match
 */
export function resolveFolder(tags, mapping, priority) {
  if (!tags || tags.length === 0) return null;
  if (!mapping || Object.keys(mapping).length === 0) return null;

  const tagSet = new Set(tags.map((t) => t.toLowerCase()));

  // Build a case-insensitive mapping lookup
  const lowerMapping = {};
  for (const [key, value] of Object.entries(mapping)) {
    lowerMapping[key.toLowerCase()] = value;
  }

  // Walk the priority list — first match wins
  for (const tag of priority || []) {
    const lower = tag.toLowerCase();
    if (tagSet.has(lower) && lowerMapping[lower]) {
      return lowerMapping[lower];
    }
  }

  // Fallback: check all tags in the order they appear
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (lowerMapping[key]) return lowerMapping[key];
  }

  return null;
}

/**
 * Generate a folder name for a tag based on the user's mode.
 * Home mode: flat folders (e.g., "Finance")
 * Business mode: grouped folders (e.g., "Sorted/Finance")
 *
 * @param {string} tag — tag name
 * @param {string} mode — "home" or "business"
 * @returns {string}
 */
export function generateFolderName(tag, mode = "home") {
  const name = tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase();
  if (mode === "business") {
    return `Sorted/${name}`;
  }
  return name;
}

/**
 * Build a default folder mapping from a list of tags.
 *
 * @param {string[]} tags — tag names
 * @param {string} mode — "home" or "business"
 * @returns {object} — { tagName: folderPath }
 */
export function buildDefaultMapping(tags, mode = "home") {
  const mapping = {};
  for (const tag of tags) {
    mapping[tag] = generateFolderName(tag, mode);
  }
  return mapping;
}
