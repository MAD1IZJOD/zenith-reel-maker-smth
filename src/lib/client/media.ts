/** A media fragment makes browsers (iOS Safari especially) paint a real frame for a paused clip instead of black. */
export function posterFrame(url: string | undefined): string | undefined {
  return url && !url.includes("#") ? `${url}#t=0.1` : url;
}
