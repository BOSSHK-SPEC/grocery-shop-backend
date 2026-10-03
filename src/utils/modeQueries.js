import { Op, literal } from 'sequelize';

// One account can sell and deliver, but `User.role` holds a single legacy
// value. Listing "riders" by `role = 'delivery'` therefore hides a seller who
// also applied to ride. These fragments select by the per-mode record in
// `misc.modes` as well, so an application is visible wherever its applicant's
// role happens to point.

const MODE_KEYS = { selling: 'merchant', delivering: 'delivery' };
// Platform staff only — not tenant admins. A merchant approved as the first
// account for a new standalone tenant is promoted to `admin` so they can
// reach the web console (see adminController.approveUser), but they are
// still that tenant's merchant and must stay visible in its directory. A
// plain promoteToAdmin() account has no recorded application at all, so the
// `IS NOT NULL` check below already excludes it without needing a role
// filter — this guards only the genuine platform-staff case.
const NON_CONSOLE_ROLES = ['super_admin'];

// Interpolated into SQL, so only ever a value from MODE_KEYS.
const modeKey = (mode) => {
  if (!Object.prototype.hasOwnProperty.call(MODE_KEYS, mode)) throw new Error(`Unknown mode: ${mode}`);
  return mode;
};

const modeStatusSql = (mode) =>
  `JSON_UNQUOTE(JSON_EXTRACT(\`User\`.\`misc\`, '$.modes.${modeKey(mode)}.status'))`;

/**
 * Users who belong in the list for [mode]: those whose legacy role says so, plus
 * anyone with a recorded application for it. Platform staff (super_admin) are
 * excluded from the second group; a tenant admin with a real application is not.
 */
export const modeMembership = (mode) => ({
  [Op.or]: [
    { role: MODE_KEYS[modeKey(mode)] },
    {
      [Op.and]: [
        literal(`${modeStatusSql(mode)} IS NOT NULL`),
        { role: { [Op.notIn]: NON_CONSOLE_ROLES } },
      ],
    },
  ],
});

/** Where-fragment for a `?status=` filter on the status of [mode]'s application. */
export const modeStatusIs = (mode, status) =>
  literal(`COALESCE(${modeStatusSql(mode)}, \`User\`.\`status\`) = ${literalString(status)}`);

const literalString = (value) => `'${String(value).replace(/[^A-Z_]/g, '')}'`;
