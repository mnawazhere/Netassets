// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_jazzy_jackal.sql';
import m0001 from './0001_third_devos.sql';
import m0002 from './0002_amusing_hercules.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002
    }
  }
  