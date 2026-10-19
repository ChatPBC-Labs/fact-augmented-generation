import { Document } from "../documents.js";

export abstract class BaseLoader {
  abstract load(): Promise<Document[]>;
}
