/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `service-manager` command */
  export type ServiceManager = ExtensionPreferences & {}
  /** Preferences accessible in the `run-openai-server` command */
  export type RunOpenaiServer = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `service-manager` command */
  export type ServiceManager = {}
  /** Arguments passed to the `run-openai-server` command */
  export type RunOpenaiServer = {}
}

