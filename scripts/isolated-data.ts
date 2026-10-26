import path from "node:path";
/** Imported first by verification scripts so their sessions never mix with the studio's real data directory. */
process.env.DATA_DIR ||= path.join(process.cwd(), "data", "verify");
