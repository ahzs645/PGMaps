export const fieldTeamProfile = {
  schema: 'brandkit/consumer-profile/1',
  id: 'field-team',
  name: 'Field team',
  version: '1',
  colours: {
    ink: '#152D28',
    paper: '#FFFFFF',
    primary: '#26715D',
    muted: '#555555',
    light: '#E6EEE9',
    reverse: '#FFFFFF',
    line: '#CCD7D1',
    rule: '#152D28',
  },
  typography: Object.fromEntries(
    ['body', 'heading', 'label'].map((role) => [
      role,
      { family: 'Arial', weight: 400, style: 'normal', fallback: 'Arial, sans-serif' },
    ]),
  ),
  logos: Object.fromEntries(
    ['primary', 'black', 'reverse'].map((role) => [
      role,
      {
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40"><path fill="${role === 'reverse' ? '#FFFFFF' : '#26715D'}" d="M0 0H200V40H0Z"/></svg>`,
        viewBox: [0, 0, 200, 40],
      },
    ]),
  ),
  provenance: { source: 'Browser test', status: 'Field team identity' },
}
