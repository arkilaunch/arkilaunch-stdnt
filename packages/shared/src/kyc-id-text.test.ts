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
    expect(fields.address).toEqual({ value: '12 SAMPLE STREET, BARANGAY UNO, QUEZON CITY', confidence: 0.94 });
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
    expect(f.address?.value).toBe('123 RIZAL ST, BRGY SAN JUAN, TAYTAY, RIZAL');
  });

  it('UMID: Surname / Given Name / Middle Name and Address, stopping at the next label', () => {
    const f = parseIdText('umid', licenceText('CRN-0111-2345678-9\nSURNAME\nREYES\nGIVEN NAME\nMARIA\nMIDDLE NAME\nLOPEZ\nSEX M DATE OF BIRTH\nADDRESS\nBLK 4 LOT 2 PILILLA RIZAL\nDATE ISSUED 2020'));
    expect(name(f)).toEqual(['MARIA', 'LOPEZ', 'REYES']);
    expect(f.address?.value).toBe('BLK 4 LOT 2 PILILLA RIZAL');
  });

  it("voter's ID reads an address on the label's own line", () => {
    const f = parseIdText('voters', licenceText('Surname: GARCIA\nFirst Name: ANA\nMiddle Name: CRUZ\nAddress: 5 MABINI ST, ANTIPOLO CITY\nPrecinct No. 0123A'));
    expect(name(f)).toEqual(['ANA', 'CRUZ', 'GARCIA']);
    expect(f.address?.value).toBe('5 MABINI ST, ANTIPOLO CITY');
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
    expect(f.address?.value).toBe('12 LUNA ST, PASIG CITY');
  });

  it('TIN ID: a LAST, FIRST MIDDLE name line and its address', () => {
    const f = parseIdText('tin_id', licenceText('TIN 123-456-789-000\nNAME\nSANTOS, MARK ANTHONY REYES\nADDRESS\nBRGY BAGUMBAYAN, PILILLA, RIZAL\nDATE OF BIRTH'));
    expect(name(f)).toEqual(['MARK ANTHONY', 'REYES', 'SANTOS']);
    expect(f.address?.value).toBe('BRGY BAGUMBAYAN, PILILLA, RIZAL');
  });
});
