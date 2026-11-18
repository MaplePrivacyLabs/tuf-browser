// Re-export crypto enums from crypto-browser
export { EcdsaTypes, HashAlgorithms, KeyTypes } from "@freedomofpress/crypto-browser";
export var Roles;
(function (Roles) {
    Roles["Root"] = "root";
    Roles["Timestamp"] = "timestamp";
    Roles["Snapshot"] = "snapshot";
    Roles["Targets"] = "targets";
})(Roles || (Roles = {}));
export const TOP_LEVEL_ROLE_NAMES = [
    Roles.Root,
    Roles.Targets,
    Roles.Snapshot,
    Roles.Timestamp,
];
//# sourceMappingURL=types.js.map