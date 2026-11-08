import "@shoelace-style/shoelace/dist/themes/light.css";
import "@shoelace-style/shoelace/dist/themes/dark.css";
import "./theme.css";
import "./app.js";
import { adoptTokenFromUrl } from "./api.js";
import { initTheme } from "./theme.js";

adoptTokenFromUrl();
initTheme();
