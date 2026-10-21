/** YouTube video ids are 11 characters from this alphabet. */
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isVideoId(value) {
  return typeof value === "string" && VIDEO_ID.test(value);
}

export function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}
