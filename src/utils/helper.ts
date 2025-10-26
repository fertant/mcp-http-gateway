
/**
 * Checks if a string is an HTTP or HTTPS URL
 * @param urlOrPath String to check
 * @returns True if the string is an HTTP(S) URL, false otherwise
 */
export function isHttpUrl(urlOrPath: string): boolean {
  return urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://');
}
