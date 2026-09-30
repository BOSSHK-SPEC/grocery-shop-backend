import { Op, literal } from 'sequelize';

// One account can sell and deliver, but `User.role` holds a single legacy
// value. Listing "riders" by `role = 'delivery'` therefore hides a seller who
// also applied to ride. These fragments select by the per-mode record in
// `misc.modes` as well, so an application is visible wherever its applicant's
// role happens to point.

const MODE_KEYS = { selling: 'merchant', delivering: 'delivery' };
const NON_CONSOLE_ROLES = ['admin', 'super_admin'];

// Interpolated into SQL, so only ever a value from MODE_KEYS.
const modeKey = (mode) => {
  if (!Object.prototype.hasOwnProperty.call(MODE_KEYS, mode)) throw new Error(`Unknown mode: ${mode}`);
  return mode;
};

const modeStatusSql = (mode) =>
  `JSON_UNQUOTE(JSON_EXTRACT(\`User\`.\`misc\`, '$.modes.${modeKey(mode)}.status'))`;

/**
 * Users who belong in the list for [mode]: those whose legacy role says so, plus
 * anyone with a recorded application for it. Admins are excluded from the second
 * group exactly as they always were from these lists.
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
