import packageJson from "../package.json";

export const APP_VERSION = packageJson.version;

export default function AppVersion() {
  return (
    <span className="app-version" aria-label={`当前版本 ${APP_VERSION}`} title={`当前版本 ${APP_VERSION}`}>
      v{APP_VERSION}
    </span>
  );
}
