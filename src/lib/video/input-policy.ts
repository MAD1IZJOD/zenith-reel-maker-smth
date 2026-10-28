/** Only self-contained media files may enter decoders; never playlists, devices or network protocols. */
export const MEDIA_INPUT_OPTIONS = [
  "-protocol_whitelist", "file",
  "-format_whitelist", "mov,matroska,webm,mp3,wav,ogg,flac,aac",
];
