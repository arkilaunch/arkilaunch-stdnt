import { describe, expect, it } from 'vitest';
import { parseIdText } from './kyc-id-text.js';
import type { DocumentText } from './document-intelligence-port.js';

export function licenceText(content: string, confidence = 0.94): DocumentText {
  let offset = 0;
  const lines = content.split('\n').map((value) => {
    const line = { offset, length: value.length, page: 1, polygon: [] };
    offset += value.length + 1;
    return line;
  });
  return { content, lines, words: lines.filter((line) => line.length).map((line) => ({ offset: line.offset, length: line.length, confidence })) };
}

describe('licence label text', () => {
  it.each([
    ['DELA CRUZ, JUAN SANTOS', 'JUAN', 'SANTOS', 'DELA CRUZ'],
    ['SAN JUAN, JUAN CARLO REYES', 'JUAN CARLO', 'REYES', 'SAN JUAN'],
    ['PEÑA, ANA', 'ANA', '', 'PEÑA'],
    [' | DELA   CRUZ,   JUAN   CARLO SANTOS | ', 'JUAN CARLO', 'SANTOS', 'DELA CRUZ'],
  ])('splits %s at the comma and final token', (value, first, middle, last) => {
    const fields = parseIdText('drivers_license', licenceText(`Last Name, First Name, Middle Name\n\n${value}\nSex\nM`));
    expect(fields).toMatchObject({ first_name: { value: first }, middle_name: { value: middle }, last_name: { value: last } });
    expect(fields.first_name?.confidence).toBe(0.94);
  });
  it.each(['LASTNAME FIRSTNAME MIDDLENAME', 'Last Nane, First Name, Middle Name', 'Last Name First Name Middle Name:'])('tolerates label spacing/noise: %s', (label) => {
    expect(parseIdText('drivers_license', licenceText(`${label}\nPEÑA, ANA MARIA REYES`)).first_name?.value).toBe('ANA MARIA');
  });
  it('does not guess a name without its comma or label', () => {
    expect(parseIdText('drivers_license', licenceText('Last Name First Name Middle Name\nDELA CRUZ JUAN SANTOS'))).toEqual({});
    expect(parseIdText('drivers_license', licenceText('DELA CRUZ, JUAN SANTOS'))).toEqual({});
  });
  it.each(['License No.', 'Expiration Date', 'Agency Code', 'Blood Type', 'Eyes Color', 'Conditions', 'Weight', 'Height', 'Sex', 'Date of Birth', 'Nationality'])('stops a multiline address at %s', (label) => {
    const fields = parseIdText('drivers_license', licenceText(`Address\n12 SAMPLE STREET\nBARANGAY UNO\nQUEZON CITY\n${label}\nOTHER VALUE`));
    expect(fields.address).toEqual({ value: '12 SAMPLE STREET BARANGAY UNO QUEZON CITY', confidence: 0.94 });
  });
  it('leaves missing or empty addresses to query-field fallback', () => {
    expect(parseIdText('drivers_license', licenceText('12 SAMPLE STREET\nQUEZON CITY'))).toEqual({});
    expect(parseIdText('drivers_license', licenceText('Address\nLicense No.\nN01-23-456789'))).toEqual({});
  });
  it('never manufactures word confidence', () => {
    const text = licenceText('Last Name First Name Middle Name\nPEÑA, ANA REYES');
    text.words = [];
    expect(parseIdText('drivers_license', text).first_name?.confidence).toBe(0);
  });
  it('leaves the unlabelled SSS card to the query fields', () => {
    expect(parseIdText('sss', licenceText('JUAN S. DELA CRUZ\nSS No. 01-2345678-9'))).toEqual({});
  });
});

// QA 36: each PH ID's own labels; fixtures follow current card samples.
describe('per-format ID text', () => {
  const name = (f: ReturnType<typeof parseIdText>) => [f.first_name?.value, f.middle_name?.value, f.last_name?.value];

  it('PhilSys: Filipino/English split labels and the Tirahan/Address block', () => {
    const f = parseIdText('philsys', licenceText(
      'REPUBLIKA NG PILIPINAS\nApelyido/Last Name\nDELA CRUZ\nMga Pangalan/Given Names\nJUAN CARLO\nGitnang Apelyido/Middle Name\nSANTOS\nPetsa ng Kapanganakan/Date of Birth\nJANUARY 01, 1990\nTirahan/Address\n123 RIZAL ST, BRGY SAN JUAN\nTAYTAY, RIZAL',
    ));
    expect(name(f)).toEqual(['JUAN CARLO', 'SANTOS', 'DELA CRUZ']);
    expect(f.address?.value).toBe('123 RIZAL ST BRGY SAN JUAN TAYTAY RIZAL');
  });

  it('UMID: Surname / Given Name / Middle Name and Address, stopping at the next label', () => {
    const f = parseIdText('umid', licenceText('CRN-0111-2345678-9\nSURNAME\nREYES\nGIVEN NAME\nMARIA\nMIDDLE NAME\nLOPEZ\nSEX M DATE OF BIRTH\nADDRESS\nBLK 4 LOT 2 PILILLA RIZAL\nDATE ISSUED 2020'));
    expect(name(f)).toEqual(['MARIA', 'LOPEZ', 'REYES']);
    expect(f.address?.value).toBe('BLK 4 LOT 2 PILILLA RIZAL');
  });

  it("voter's ID reads an address on the label's own line", () => {
    const f = parseIdText('voters', licenceText('Surname: GARCIA\nFirst Name: ANA\nMiddle Name: CRUZ\nAddress: 5 MABINI ST, ANTIPOLO CITY\nPrecinct No. 0123A'));
    expect(name(f)).toEqual(['ANA', 'CRUZ', 'GARCIA']);
    expect(f.address?.value).toBe('5 MABINI ST ANTIPOLO CITY');
  });

  it('passport: the MRZ names win, and no address is read', () => {
    const f = parseIdText('passport', licenceText('Apelyido/Surname\nDELA CRUZ\nMga Pangalan/Given Names\nJUAN\nAddress\nNOT ON A PASSPORT\nP<PHLDELA<CRUZ<<JUAN<CARLO<<<<<<<<<<<<<<<<<<<'));
    expect(f.last_name?.value).toBe('DELA CRUZ');
    expect(f.first_name?.value).toBe('JUAN CARLO');
    expect(f.address).toBeUndefined();
  });

  it('PRC: names only, no address', () => {
    const f = parseIdText('prc', licenceText('LAST NAME\nTAN\nFIRST NAME\nLEA\nMIDDLE NAME\nGO\nAddress\n1 X ST'));
    expect(name(f)).toEqual(['LEA', 'GO', 'TAN']);
    expect(f.address).toBeUndefined();
  });

  it('postal ID: one First M. Last line and its address', () => {
    const f = parseIdText('postal', licenceText('NAME\nJUAN C. DELA-CRUZ\nADDRESS\n12 LUNA ST, PASIG CITY\nPRN 100141234567P'));
    expect(name(f)).toEqual(['JUAN', 'C.', 'DELA-CRUZ']);
    expect(f.address?.value).toBe('12 LUNA ST PASIG CITY');
  });

  it('TIN ID: a LAST, FIRST MIDDLE name line and its address', () => {
    const f = parseIdText('tin_id', licenceText('TIN 123-456-789-000\nNAME\nSANTOS, MARK ANTHONY REYES\nADDRESS\nBRGY BAGUMBAYAN, PILILLA, RIZAL\nDATE OF BIRTH'));
    expect(name(f)).toEqual(['MARK ANTHONY', 'REYES', 'SANTOS']);
    expect(f.address?.value).toBe('BRGY BAGUMBAYAN PILILLA RIZAL');
  });
});

// QA 37: fixtures transcribed from the user's card samples (line order as printed).
describe('ID card samples', () => {
  const name = (f: ReturnType<typeof parseIdText>) => [f.first_name?.value, f.middle_name?.value, f.last_name?.value];

  it('old TIN card: unlabelled LAST, FIRST MIDDLE above TIN: and the address below it', () => {
    const f = parseIdText('tin_id', licenceText('REPUBLIC OF THE PHILIPPINES\nDEPARTMENT OF FINANCE\nBUREAU OF INTERNAL REVENUE\nGODES, ALDRIN TITO\nTIN: 418-003-645-000\nCHRISTIAN VILLAGE, PUROK 10, APLAYA, DIGOS CITY\nDAVAO DEL SUR 8002\nBirth Date: 01/03/1994\nIssue Date: 11/17/2016\nSignature'));
    expect(name(f)).toEqual(['ALDRIN', 'TITO', 'GODES']);
    expect(f.address?.value).toBe('CHRISTIAN VILLAGE PUROK 10 APLAYA DIGOS CITY DAVAO DEL SUR 8002');
  });

  it('new TIN card: Name and a two-line Address', () => {
    const f = parseIdText('tin_id', licenceText('BUREAU OF INTERNAL REVENUE\nTIN\n302-280-158-61000\nName\nRAMOS, ELLA JOY\nAddress\nBLK 15 LOT 2 MALINAWON VILLAGE, MATINA\nCROSSING, DAVAO CITY\nBirthdate:\n11 JULY 1998\nTIN Issuance Date:'));
    expect(name(f)).toEqual(['ELLA', 'JOY', 'RAMOS']);
    expect(f.address?.value).toBe('BLK 15 LOT 2 MALINAWON VILLAGE MATINA CROSSING DAVAO CITY');
  });

  it("voter's ID: unlabelled LAST / FIRST / MIDDLE above Date of Birth, address up to Precinct No.", () => {
    const f = parseIdText('voters', licenceText('COMMISSION ON ELECTIONS\nCITY OF PARAÑAQUE, NCR - FOURTH DISTRICT\nVIN : 7604-0240B-C2180CHC20000-3\nCORTEZ\nCHRIS ANN\nHIPOLITO\nDate of Birth : March 21, 1980\nCivil Status : Single\nCitizenship : Filipino\nAddress :\n5674 LOPEZ JAENA ST.\nSAN DIONISIO\nPrecinct No. : 0240B'));
    expect(name(f)).toEqual(['CHRIS ANN', 'HIPOLITO', 'CORTEZ']);
    expect(f.address?.value).toBe('5674 LOPEZ JAENA ST. SAN DIONISIO');
  });

  it('postal ID: FIRST MIDDLE SURNAME under its combined label, keeping DELA CRUZ whole', () => {
    const f = parseIdText('postal', licenceText('POSTAL IDENTITY CARD\nFirst Name, Middle Name, Surname, Suffix\nJUANA REYES DELA CRUZ\nAddress\n585 GEN. TUAZON BLVD.\nBRGY. RIVERA\n1742 PASAY CITY\nDate of Birth\nNationality\n14 Aug 88\nPHL\nPRN 100141234567 P'));
    expect(name(f)).toEqual(['JUANA', 'REYES', 'DELA CRUZ']);
    expect(f.address?.value).toBe('585 GEN. TUAZON BLVD. BRGY. RIVERA 1742 PASAY CITY');
  });

  it('PRC ID: labels with arrows, the suffix stays with the first name, no address', () => {
    const f = parseIdText('prc', licenceText('PROFESSIONAL REGULATION COMMISSION\nPROFESSIONAL IDENTIFICATION CARD\nLAST NAME ► HOFER\nFIRST NAME ► THOMAS II\nMIDDLE NAME ► REDIDO\nREGISTRATION NO. ► 0123456\nREGISTRATION DATE ► 09/03/2004\nVALID UNTIL ► 03/04/2026'));
    expect(name(f)).toEqual(['THOMAS II', 'REDIDO', 'HOFER']);
    expect(f.address).toBeUndefined();
    expect(name(parseIdText('prc', licenceText('LAST NAME HOFER\nFIRST NAME THOMAS II\nMIDDLE NAME REDIDO')))).toEqual(['THOMAS II', 'REDIDO', 'HOFER']);
  });

  it("old SSS card: the line above the SS number, never the president's signature", () => {
    const f = parseIdText('sss', licenceText('Republic of the Philippines\nSocial Security System\nRODANTE PARADERO AQUINO\n33-8740383-5\nCORAZON S. DE LA PAZ\nSSS PRESIDENT\nPROUD TO BE A FILIPINO'));
    expect(name(f)).toEqual(['RODANTE', 'PARADERO', 'AQUINO']);
    expect(f.address).toBeUndefined();
  });

  it('MySSS card: Given / Middle / Surname labels', () => {
    const f = parseIdText('sss', licenceText('SOCIAL SECURITY SYSTEM\nMySSS CARD\nGIVEN NAME\nREDMOND JEROME\nMIDDLE NAME\nMERCADO\nSURNAME\nGONZALES\n3 3 - 1 2 3 4 5 6 7 - 8'));
    expect(name(f)).toEqual(['REDMOND JEROME', 'MERCADO', 'GONZALES']);
  });

  it('passport: Filipino/English labels give the middle name; the MRZ gives the rest', () => {
    const f = parseIdText('passport', licenceText('PASAPORTE/ PASSPORT\nApelyido/ Surname\nDELA CRUZ\nPangalan/ Given names\nMARIA\nPanggitnang apelyido/ Middle name\nSANTOS\nPetsa ng kapanganakan/ Date of birth\n16 MAR 1980\nP<PHLDELA<CRUZ<<MARIA<<<<<<<<<<<<<<<<<<<<<<<<'));
    expect(name(f)).toEqual(['MARIA', 'SANTOS', 'DELA CRUZ']);
  });

  it('UMID: a four-line address after the SEX/DATE OF BIRTH line', () => {
    const f = parseIdText('umid', licenceText('Unified Multi-Purpose ID\nCRN - 0028-1215160-9\nSURNAME\nSANTOS\nGIVEN NAME\nJOSE\nMIDDLE NAME\nCRUZ\nSEX M DATE OF BIRTH 1960/01/28\nADDRESS\n28 PAYAPA ST BAGONG DIWA\nSTO CRISTOBAL CALOOCAN CITY\nMETRO MANILA\nPHILIPPINES 1800'));
    expect(name(f)).toEqual(['JOSE', 'CRUZ', 'SANTOS']);
    expect(f.address?.value).toBe('28 PAYAPA ST BAGONG DIWA STO CRISTOBAL CALOOCAN CITY METRO MANILA PHILIPPINES 1800');
  });

  it.each([
    ['JUAN S. DELA CRUZ', 'JUAN', 'S.', 'DELA CRUZ'],
    ['ANA MARIA C. DE LOS SANTOS', 'ANA MARIA', 'C.', 'DE LOS SANTOS'],
    ['PEDRO REYES STA. MARIA JR', 'PEDRO JR', 'REYES', 'STA. MARIA'],
    ['JOSE SAN JUAN', 'JOSE', '', 'SAN JUAN'],
  ])('keeps surname particles whole: %s', (value, first, middle, last) => {
    expect(name(parseIdText('postal', licenceText(`NAME\n${value}`)))).toEqual([first, middle, last]);
  });

  it('leaves no comma in any parsed field', () => {
    const f = parseIdText('drivers_license', licenceText('Last Name, First Name, Middle Name\nDELA CRUZ, JUAN, SANTOS\nAddress\n12 SAMPLE ST., BRGY UNO,\nQUEZON CITY'));
    for (const field of Object.values(f)) expect(field.value).not.toContain(',');
    expect(name(f)).toEqual(['JUAN', 'SANTOS', 'DELA CRUZ']);
  });
});
