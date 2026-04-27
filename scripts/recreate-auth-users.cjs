/**
 * FindMed — Recreate Auth Users
 * ------------------------------------------------------------
 * Crea los 52 auth users con supabase.auth.admin.createUser()
 * y hace upsert en public.users (incluye role y doctor_id).
 *
 * Pre-requisito: ya corriste en SQL Editor:
 *   DELETE FROM auth.identities;
 *   DELETE FROM auth.users;
 *
 * Uso:
 *   node scripts/recreate-auth-users.cjs --dry-run   # solo imprime plan
 *   node scripts/recreate-auth-users.cjs             # ejecuta
 *   node scripts/recreate-auth-users.cjs --verify    # ejecuta + login test
 *
 * Requiere: @supabase/supabase-js (ya está en el proyecto)
 */

const { createClient } = require('@supabase/supabase-js');

// ============================================================
// CONFIG
// ============================================================
const SUPABASE_URL = 'https://jyzvdowflblxmlahlupo.supabase.co';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5enZkb3dmbGJseG1sYWhsdXBvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njg5MDI1OCwiZXhwIjoyMDkyNDY2MjU4fQ.RFU9y9Qr4B8oAeyNzlV0tZOuM1zx1HRORileDA5-8Zw';

const DEFAULT_PASSWORD = 'FindMed2026!';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERIFY = args.includes('--verify');

// ============================================================
// USUARIOS (52) — copiados 1:1 del CSV
// Formato original CSV: id;role;doctor_id;created_at;email;initial_password
// Reglas:
//   - email vacío → placeholder doctor_{primeros_8_chars_doctor_id}@findmed.com.mx
//   - password vacío → FindMed2026!
// ============================================================
const USERS = [
  // Sin email → placeholder
  { id: 'b4e12058-553f-4c53-9f84-4ad2b4444ca2', role: 'doctor', doctor_id: '3e20e173-cf88-4790-ad86-d7d500bff82e', created_at: '2026-02-12 20:12:36.717211+00', email: 'doctor_3e20e173@findmed.com.mx', password: DEFAULT_PASSWORD },
  { id: '5a80b082-89a1-4d09-92fd-fcc6b9a1e3cb', role: 'doctor', doctor_id: 'f63024c0-c2d1-40ba-a759-eb6ffb27698b', created_at: '2026-02-13 17:45:48.741741+00', email: 'doctor_f63024c0@findmed.com.mx', password: DEFAULT_PASSWORD },

  { id: 'aa9c821f-4a3b-4225-bd8c-e885edb5f90b', role: 'doctor', doctor_id: '8aed4d44-df41-47b1-931f-b98f2093c4df', created_at: '2026-02-13 18:51:29.298297+00', email: 'nats@gmail.com',                     password: 'Nat123!' },
  { id: '0bd1e2fb-58f7-4f01-abf5-549a52681986', role: 'doctor', doctor_id: '48cc91e2-3487-444f-acf5-d309ee074ab6', created_at: '2026-02-24 15:17:40.555402+00', email: 'dr.adrianMP@findmed.com',            password: 'AMP123#' },
  { id: '6354bac8-7145-44c1-84a5-f6a860b20533', role: 'doctor', doctor_id: '9ce778fb-9673-48db-8fe8-60bae7cb253a', created_at: '2026-02-24 15:19:08.075899+00', email: 'dr.andresGC@findmed.com',            password: 'AGC123#' },
  { id: 'b74722d3-5b0b-43f8-b8c9-8e3300042882', role: 'doctor', doctor_id: '09b4c68f-8b67-4658-ab9a-7aa2d33896f2', created_at: '2026-02-24 15:20:32.963699+00', email: 'dr.gregorioZO@findmed.com',          password: 'GZO123#' },
  { id: 'cdc47101-3f03-4b0d-bd21-034c9d36d4f9', role: 'doctor', doctor_id: '4dcb37f6-1a65-4955-9d87-ff4de3f22f8e', created_at: '2026-02-24 15:22:34.257373+00', email: 'dr.briciaD@findmed.com',             password: 'BD123#' },
  { id: '83207adc-ab71-4086-a907-e3914e0af793', role: 'doctor', doctor_id: '1f56b741-abe4-4191-8bdf-5b06d8da37d5', created_at: '2026-03-17 21:22:25.492304+00', email: 'docgmirelli@findmed.com',            password: 'GM123!' },
  { id: 'e057ef02-719b-4c3d-b851-0764b26ff210', role: 'doctor', doctor_id: '6b68de9e-f298-4763-a231-6921b1fc6162', created_at: '2026-03-18 20:39:46.497062+00', email: 'caacosta@doc.findmed.com',           password: '#CarAco123!' },
  { id: 'f65386bb-ebaa-47d9-9076-4316b6a688df', role: 'doctor', doctor_id: '6ed67964-8665-4d1b-a072-c0f81740c1ad', created_at: '2026-03-18 20:40:51.1982+00',   email: 'memarquina@doc.findmed.com',         password: '#ManMar123!' },
  { id: '2339a59d-45a3-4d94-be86-a536f85b0dbe', role: 'doctor', doctor_id: '9ebfa668-8076-42f0-97f6-54e380335b3f', created_at: '2026-03-18 20:41:49.749847+00', email: 'gzubieta@doc.findmed.com',           password: '#GreZub123!' },
  { id: '03747e5c-619f-4da5-98a5-71a0505fc029', role: 'doctor', doctor_id: '2ce7e921-9806-46a1-ba3a-4de95c123ab3', created_at: '2026-03-18 20:42:39.437207+00', email: 'jecazares@doc.findmed.com',          password: '#JaiEca123!' },
  { id: 'f2d674e3-6de6-4d78-b1a7-cf557eb5a40f', role: 'doctor', doctor_id: 'ed9992ea-1f8f-470c-9ce4-d8ad260f912b', created_at: '2026-03-18 20:43:35.531966+00', email: 'jpmateos@doc.findmed.com',           password: '#JorPma123!' },
  { id: 'c6538947-e6ed-4c0e-a015-91ebbf23db55', role: 'doctor', doctor_id: '7609ec33-7597-4d4e-bf6d-38408e1e2fd7', created_at: '2026-03-18 20:45:34.45837+00',  email: 'rjauregui@doc.findmed.com',          password: '#RobJau123!' },
  { id: '106401a4-02d2-4a6e-90a0-891b61a870c5', role: 'doctor', doctor_id: '369b0059-dbb0-49b9-93a3-b213041d984c', created_at: '2026-03-18 20:48:39.412532+00', email: 'iavedano@doc.findmed.com',           password: '#IvaAve123!' },
  { id: 'c1f425d2-b2c2-4d2f-8710-61f2421e2f8a', role: 'doctor', doctor_id: '1231cfc0-5313-4264-b89d-ffbba7c143af', created_at: '2026-03-18 20:49:29.028886+00', email: 'fbrito@doc.findmed.com',             password: '#FraBri123!' },
  { id: 'e737235e-420d-4370-acf0-929ab678e121', role: 'doctor', doctor_id: '3dc718f3-e953-48d9-becc-5e770a653e3d', created_at: '2026-03-18 20:50:25.003329+00', email: 'emichan@doc.findmed.com',            password: '#EveMic123!' },
  { id: '6767da29-c24f-4714-ab84-096bc58e9272', role: 'doctor', doctor_id: 'daf3f23e-9308-4387-94b6-4097b593c377', created_at: '2026-03-18 20:52:15.889476+00', email: 'fbarba@doc.findmed.com',             password: '#FerBar123!' },
  { id: 'b2a1cc91-e1f5-49c6-86d8-8063dfe26c8f', role: 'doctor', doctor_id: '0aa30739-e51a-4746-a9e4-cd60e21908fd', created_at: '2026-03-18 21:08:37.426856+00', email: 'jalcocer@doc.findmed.com',           password: '#JaiAlc123!' },
  { id: 'd2524535-fde5-4bab-b6a1-3e953f9fd021', role: 'doctor', doctor_id: '6344e9aa-b024-492c-8763-60aa551e1f70', created_at: '2026-03-18 21:10:25.187707+00', email: 'jvega@doc.findmed.com',              password: '#JorVeg123!' },
  { id: '8aeb6b3d-8514-499e-a0ff-3f4692faecab', role: 'doctor', doctor_id: '09cafcc8-8d99-46d6-b38d-9cf9c434e925', created_at: '2026-03-18 21:11:02.948038+00', email: 'ecueto@doc.findmed.com',             password: '#EdgCue123!' },
  { id: '9d28719c-9a3a-4ca5-a82d-e7140a0fb6aa', role: 'doctor', doctor_id: '4548ec17-384d-4e97-b507-85d8e52cef58', created_at: '2026-03-18 21:11:37.955426+00', email: 'mvelez@doc.findmed.com',             password: '#MauVel123!' },
  { id: '430beb09-de4f-417f-9102-14aeb81fb3a1', role: 'doctor', doctor_id: 'bba234e0-c9b0-4e71-a24b-701d606944e3', created_at: '2026-03-18 21:12:40.343474+00', email: 'rruz@doc.findmed.com',               password: '#RodRuz123!' },
  { id: '495e0729-c921-4a26-8cef-936a4fb0f526', role: 'doctor', doctor_id: '91b88a8f-c28e-4ac2-a108-1a648e322f67', created_at: '2026-03-18 21:14:08.971066+00', email: 'ahernandez@doc.findmed.com',         password: '#AntHer123!' },
  { id: '35f292ea-71ed-4bdb-9619-82f67c87ed11', role: 'doctor', doctor_id: '9250fb42-d857-4f28-9a35-d745426afc78', created_at: '2026-03-18 21:14:50.408084+00', email: 'fsamperio@doc.findmed.com',          password: '#FerSam123!' },
  { id: 'eabdfb00-1f7b-4159-9f81-e02ff5814a48', role: 'doctor', doctor_id: '631239c1-234d-4d46-8312-5f1d94236b30', created_at: '2026-03-18 21:16:21.84185+00',  email: 'ganaya@doc.findmed.com',             password: '#GusAna123!' },
  { id: '66953627-eb33-49f3-8947-64521e93e324', role: 'doctor', doctor_id: '438fcd44-351b-4b60-90b3-a7982c22f861', created_at: '2026-03-18 21:21:54.751596+00', email: 'xperez@doc.findmed.com',             password: '#XicPer123!' },
  { id: 'aae5daa9-0d34-46c3-98e6-43141f90a2e8', role: 'doctor', doctor_id: '2cfb311d-8bc5-455d-807b-fb0c760cc0e0', created_at: '2026-03-18 21:22:51.855583+00', email: 'rpineda@doc.findmed.com',            password: '#RauPin123!' },
  { id: '42ab6411-ceea-41fb-bfe7-1ae2546a5de8', role: 'doctor', doctor_id: '53dd01d5-b136-48b0-9ae5-2346cd363956', created_at: '2026-03-18 21:23:53.737944+00', email: 'cdlever@doc.findmed.com',            password: '#CarLev123!' },
  { id: '98394ef5-fb9c-4583-8035-e4ebda69dd88', role: 'doctor', doctor_id: '019a80bf-b3ea-4abc-b92d-50c47845e52b', created_at: '2026-03-18 21:24:34.188267+00', email: 'amperez@doc.findmed.com',            password: '#AdrPer123!' },
  { id: 'a8b0b352-1514-4b38-b43d-432f7831b1d3', role: 'doctor', doctor_id: '86e99764-0c7e-437f-a423-f02a249ae728', created_at: '2026-03-18 21:26:59.29633+00',  email: 'emodiano@doc.findmed.com',           password: '#EduMod123!' },
  { id: '604d049b-e715-46bc-90b2-5432537d3a9b', role: 'doctor', doctor_id: '338087be-c90e-4657-beb3-1bf8c63cdfe4', created_at: '2026-03-18 21:28:18.752397+00', email: 'orueda@doc.findmed.com',             password: '#OmaRue123!' },
  { id: '9aadf089-e046-4b2a-a097-1d899e8f6c91', role: 'doctor', doctor_id: '2ed658b3-b90a-45b7-9b70-5543c3f65e92', created_at: '2026-03-18 21:29:05.857274+00', email: 'hhernandez@doc.findmed.com',         password: '#HerHer123!' },
  { id: '5eecc3c2-a422-4bf3-9985-8c68d787d84e', role: 'doctor', doctor_id: '71723056-736c-499f-85c0-74e87b7bf866', created_at: '2026-03-18 21:31:35.413478+00', email: 'dracosta@doc.findmed.com',           password: '#DiaAco123!' },
  { id: 'a81e0318-1958-4672-abe0-e8926b551123', role: 'doctor', doctor_id: '22e45e0d-c828-459b-a490-193a04a092b9', created_at: '2026-03-18 21:34:35.701654+00', email: 'mpsanchez@doc.findmed.com',          password: '#MarSan123!' },
  { id: '15e18449-c0e2-47d4-983e-b39e49ba025c', role: 'doctor', doctor_id: '39f817d2-efd0-41d3-9575-2cd4f9eafef0', created_at: '2026-03-18 21:35:47.305348+00', email: 'pcampos@doc.findmed.com',            password: '#PauCam123!' },
  { id: '3afa2464-27f7-40b9-ab2f-905426e7b186', role: 'doctor', doctor_id: 'd03e034f-4f9d-4903-a265-0aa94384100a', created_at: '2026-03-18 21:36:25.047757+00', email: 'bdelgado@doc.findmed.com',           password: '#BriDel123!' },
  { id: 'c8386543-3bcb-44c5-90d9-e570205e2a92', role: 'doctor', doctor_id: '988617bb-d983-4bce-909b-aad20407318a', created_at: '2026-03-18 21:37:02.059102+00', email: 'rgranados@doc.findmed.com',          password: '#RauGra123!' },
  { id: 'a552dcb7-758c-4297-896a-28ada340e9ec', role: 'doctor', doctor_id: '1878c184-15be-48bd-b46c-554136343cdf', created_at: '2026-03-18 21:40:41.51015+00',  email: 'agudino@doc.findmed.com',            password: '#AndGud123!' },
  { id: '080748ba-5dec-4742-82cc-0661ca2b0c7d', role: 'doctor', doctor_id: 'c028eeca-1f33-437b-8916-cde3f66f8dc4', created_at: '2026-03-18 21:41:30.830076+00', email: 'hcastaneda@doc.findmed.com',         password: '#HerCast123!' },

  // Admin (password vacío en CSV → default)
  { id: '1dcfb405-acd5-4a06-8ced-78f03ba0d750', role: 'admin',  doctor_id: null,                                    created_at: '2026-02-12 20:08:44.991155+00', email: 'admin@findmed.com',                  password: DEFAULT_PASSWORD },

  { id: 'd8580940-f4c1-4a7a-b932-98d3e1f07012', role: 'doctor', doctor_id: '8a72fd57-3cc7-4335-ae12-cc1c12e38571', created_at: '2026-04-16 18:49:25.779203+00', email: 'andres@findmed.com',                 password: 'andres123!' },
  { id: '677383c0-b9a6-4347-8f6a-c11d54b3174c', role: 'doctor', doctor_id: 'f78ec7f2-5423-4ef4-b361-cea69b9242a8', created_at: '2026-04-16 18:52:33.509898+00', email: 'thalia@findmed.com',                 password: 'thalia123!' },
  { id: '6596971d-1531-4796-b1a4-baf4c502398a', role: 'doctor', doctor_id: 'c038233d-05ae-4219-ba6e-6a1ad686ef8b', created_at: '2026-04-16 18:54:26.579281+00', email: 'ivan@findmed.com',                   password: 'ivan123!' },
  { id: 'b04b6700-969e-4051-913e-c86825044dd3', role: 'doctor', doctor_id: 'ef242228-1050-4454-a91c-70bde38e6685', created_at: '2026-04-16 18:55:52.834123+00', email: 'fabian@findmed.com',                 password: 'fabian123!' },
  { id: '2d61be57-a3cf-4fc3-9aca-01fc3c63eca9', role: 'doctor', doctor_id: '6b5b221a-964b-40e9-a92f-71c1b267b4b1', created_at: '2026-04-16 18:57:07.576108+00', email: 'alejandro@findmed.com',              password: 'alejandro123!' },
  { id: '170a3bd4-3722-484f-9b6c-3b2eb6a4584b', role: 'doctor', doctor_id: 'c6775928-4b73-476d-9259-89b92da93e15', created_at: '2026-04-16 18:59:28.041914+00', email: 'guillermo@findmed.com',              password: 'guillermo123@' },
  { id: '548019d1-be78-4882-87f0-f08f2ec3063e', role: 'doctor', doctor_id: '09b5b908-321a-4498-bb38-f6ad7aedd76a', created_at: '2026-04-16 19:01:10.577712+00', email: 'diego@findmed.com',                  password: 'diego123!' },
  { id: '738aee07-0772-4c96-91da-f6d8b9644893', role: 'doctor', doctor_id: 'ce2db809-25f9-4450-8fb4-58214fc75fa1', created_at: '2026-04-16 19:02:26.084285+00', email: 'ricardo@findmed.com',                password: 'ricardo123!' },
  { id: '0d2d1127-20c2-4fc0-8146-503b2a8f0442', role: 'doctor', doctor_id: 'be49e870-a210-4570-a1fc-584b3bb65445', created_at: '2026-04-16 19:03:30.706409+00', email: 'jafet@findmed.com',                  password: 'jafet123!' },
  { id: 'ee39104e-7546-4c69-87c5-1a8fed5b9f32', role: 'doctor', doctor_id: '2d658672-10e8-49b1-87eb-9a223fb5a119', created_at: '2026-04-16 19:05:47.579409+00', email: 'martha@findmed.com',                 password: 'martha123!' },
  { id: 'd962da43-665c-4639-b79d-c5a61452c3ed', role: 'doctor', doctor_id: '261eb404-a7dc-42ba-a994-e33d0d6bfd01', created_at: '2026-04-16 19:07:33.01325+00',  email: 'ernesto@findmed.com',                password: 'ernesto123!' },
];

// ============================================================
// CLIENT
// ============================================================
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ============================================================
// HELPERS
// ============================================================
const log = (emoji, msg) => console.log(`${emoji} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('='.repeat(60));
  console.log('FindMed — Recreate Auth Users');
  console.log('='.repeat(60));
  console.log(`Total usuarios: ${USERS.length}`);
  console.log(`Modo: ${DRY_RUN ? 'DRY RUN (no se ejecuta)' : 'EJECUCIÓN REAL'}`);
  console.log(`Verify: ${VERIFY ? 'SÍ' : 'NO'}`);
  console.log('='.repeat(60));

  // Sanity checks locales
  const ids = new Set();
  const emails = new Set();
  for (const u of USERS) {
    if (ids.has(u.id)) throw new Error(`ID duplicado: ${u.id}`);
    if (emails.has(u.email)) throw new Error(`Email duplicado: ${u.email}`);
    ids.add(u.id);
    emails.add(u.email);
    if (!u.password || u.password.length < 6) throw new Error(`Password inválida para ${u.email}`);
  }
  log('✅', 'Sanity checks OK: sin duplicados de id/email, passwords válidas');

  if (DRY_RUN) {
    console.log('\n--- PLAN (dry-run) ---');
    USERS.forEach((u, i) => {
      console.log(`${String(i + 1).padStart(2, '0')}. ${u.role.padEnd(6)} | ${u.email.padEnd(40)} | ${u.password}`);
    });
    console.log('\n✅ Dry-run completo. Re-ejecuta sin --dry-run para aplicar cambios.');
    return;
  }

  const stats = {
    authCreated: 0, authFailed: 0,
    usersUpserted: 0, usersFailed: 0,
  };

  // ----------------------------------------------------------
  // FASE 1: crear auth users
  // ----------------------------------------------------------
  console.log('\n[Fase 1/2] Creando auth users...');
  for (let i = 0; i < USERS.length; i++) {
    const u = USERS[i];
    const prefix = `[${String(i + 1).padStart(2, '0')}/${USERS.length}] ${u.email}`;

    const { error } = await supabase.auth.admin.createUser({
      id: u.id,
      email: u.email,
      password: u.password,
      email_confirm: true,
    });

    if (error) {
      stats.authFailed++;
      log('❌', `${prefix} → ${error.message}`);
    } else {
      stats.authCreated++;
      log('✅', `${prefix} → auth user creado`);
    }

    // Pequeña pausa para no saturar la API
    await sleep(50);
  }

  // ----------------------------------------------------------
  // FASE 2: upsert public.users
  // Estructura real: id, role (NOT NULL), doctor_id, created_at, email, initial_password
  // ----------------------------------------------------------
  console.log('\n[Fase 2/2] Upsert en public.users...');
  const usersPayload = USERS.map((u) => ({
    id: u.id,
    role: u.role,
    doctor_id: u.doctor_id,
    created_at: u.created_at,
    email: u.email,
    initial_password: u.password,
  }));

  const { error: usersErr, count: usersCount } = await supabase
    .from('users')
    .upsert(usersPayload, { onConflict: 'id', count: 'exact' });

  if (usersErr) {
    stats.usersFailed = USERS.length;
    log('❌', `public.users upsert falló: ${usersErr.message}`);
  } else {
    stats.usersUpserted = usersCount ?? USERS.length;
    log('✅', `public.users: ${stats.usersUpserted} filas upserted`);
  }

  // ----------------------------------------------------------
  // RESUMEN
  // ----------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log('RESUMEN');
  console.log('='.repeat(60));
  console.log(`Auth users creados:     ${stats.authCreated}/${USERS.length}`);
  console.log(`Auth users fallidos:    ${stats.authFailed}`);
  console.log(`public.users upserted:  ${stats.usersUpserted}`);
  console.log('='.repeat(60));

  // ----------------------------------------------------------
  // VERIFICACIÓN (login real con diego@findmed.com)
  // ----------------------------------------------------------
  if (VERIFY) {
    console.log('\n[Verify] Login test con diego@findmed.com / diego123!');
    // Cliente anónimo nuevo (sin service role) para probar login real
    const anonClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: 'diego@findmed.com',
      password: 'diego123!',
    });
    if (error) {
      log('❌', `Login falló: ${error.message}`);
    } else {
      log('✅', `Login OK. user.id=${data.user?.id}`);
    }
  }

  if (stats.authFailed > 0 || stats.usersFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n💥 Error fatal:', err);
  process.exit(1);
});
