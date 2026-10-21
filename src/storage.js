/** localStorage key for the optional "remember on this device" checkbox. */
export const KEY_STORAGE = "jev-thumbnail-critic.apiKey";

export function loadRememberedKey(storage) {
  try {
    return storage.getItem(KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

export function saveRememberedKey(storage, key) {
  try {
    storage.setItem(KEY_STORAGE, key);
  } catch {
    /* Private mode and full disks should not break the page. */
  }
}

export function forgetRememberedKey(storage) {
  try {
    storage.removeItem(KEY_STORAGE);
  } catch {
    /* Same as save: storage may be unavailable. */
  }
}
