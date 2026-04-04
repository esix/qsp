/** A single action within a QSP location */
export interface QspAction {
  /** Image path (relative), empty string if none */
  image: string;
  /** Display name of the action */
  name: string;
  /** QSP code executed when the action is triggered */
  code: string;
}

/** A QSP location (scene/room) */
export interface QspLocation {
  /** Location identifier */
  name: string;
  /** Base description (HTML allowed) */
  description: string;
  /** QSP code executed when the location is visited */
  code: string;
  /** Interactive actions available at this location */
  actions: QspAction[];
}

/** Parsed QSP game file */
export interface QspGame {
  /** Format version string from the editor */
  version: string;
  /** Password (usually "No") */
  password: string;
  /** All locations in the game */
  locations: QspLocation[];
  /** Whether this was an old-format file */
  isOldFormat: boolean;
}
