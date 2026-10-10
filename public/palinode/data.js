/* Palinode's story and balance. The engine is also playable without a browser. */
(function (root) {
  'use strict';
  const D = {
    VERSION: 1,
    SAVE_KEY: 'amog.palinode.v1',
    PROLOGUE_REVISION: 2,
    NOTICE_TURN: 5,
    REVEAL_TURN: 18,
    CLUES_NEEDED: 4,
    PHASES: ['The evening post', 'The wrong address', 'The other side', 'The outside'],
    OPENING: [
      ['self', 'Rain rattles the front window. You drag the last sack of post beneath the counter.'],
      ['self', 'The kettle has boiled dry again. The caretaker has left a note: “Do what you can for them. Lock up when you’re done.”'],
      ['self', 'You know this desk by its scratches. A few last favors, then the walk home.']
    ],
    POST: [
      { subject: 'A parcel for the bakery', text: 'Wrong street, right village. “Please get this to the baker before closing. It’s for tomorrow.”',
        help: 'You carry the parcel down to the bakery. The baker presses a still-warm bun into your palm. It leaves flour on your coat.',
        sabotage: 'You send the parcel to the fishmonger. The baker can stand to be less particular about closing time.' },
      { subject: 'Sunday at the ferry', text: 'The ferry keeper needs someone to cover a shift. The request is underlined three times.',
        help: 'You pin the request above the stamp drawer and ask around. By teatime, someone has offered to cover Sunday.',
        sabotage: 'You put the ferry keeper’s urgent request beneath the seed catalogues. You can underline things too.' },
      { subject: 'The school concert', text: '“Six extra chairs, if the post office can spare them. The children have been rehearsing all week.”',
        help: 'You stack six chairs by the door. From across the square comes a recorder playing the same brave, wrong note.',
        sabotage: 'You send six stools with one short leg apiece. The concert will have a rhythm section after all.' },
      { subject: 'An envelope without a stamp', text: 'A letter to the coast, carefully addressed in a child’s handwriting. No return address. No postage.',
        help: 'You pay the postage from the loose change in your pocket. A letter to the sea ought to reach it.',
        sabotage: 'You stamp INSUFFICIENT POSTAGE across the little drawing of a boat. Rules are rules, when you feel like it.' },
      { subject: 'A notice from the council', text: '“Please display prominently: the square will close for repairs. We apologize for the inconvenience.”',
        help: 'You put the notice where everyone can see it and draw a little map around the roadworks.',
        sabotage: 'You change “close for repairs” to “close forever.” By supper, the council has received twelve indignant calls.' },
      { subject: 'The widow’s pension', text: 'An envelope has slipped behind the ledger. It should have gone out yesterday.',
        help: 'You take the envelope up the hill yourself. She insists you stay for tea. You are late getting back.',
        sabotage: 'You ease the envelope a little farther behind the ledger. One more day is hardly your problem.' },
      { subject: 'A roof before winter', text: 'The caretaker wants the old roofer’s address. You have it somewhere in the bottom drawer.',
        help: 'You find the address under a photograph from last summer. The caretaker thanks you without looking up from the leak.',
        sabotage: 'You supply the address of a roofer who retired years ago. Perhaps the caretaker should have fixed the drawer first.' },
      { subject: 'One missing terrier', text: 'A reward notice, already damp at the edges. “Answers to anything if you have cheese.”',
        help: 'You set a saucer by the back steps. By dusk the terrier is asleep on your coat, smelling of rain and terrible decisions.',
        sabotage: 'You pin the reward notice inside the broom cupboard. The terrier has probably enjoyed a day to itself.' }
    ],
    LISTEN: [
      'Two envelopes have the same postmark, down to the little nick in the ink. The village only has one stamping machine. Of course they do.',
      'A letter is addressed to the old schoolhouse. It burned down before you took this job. Someone must be working from an old address book.',
      'One envelope carries tomorrow’s date. The date wheel sticks when it rains. You make a note to fix it.',
      'Under the caretaker’s note is a forwarding slip. The address is the post office itself, with a basement number you have never used.',
      'You check the photograph from last summer. The sign behind you has the wrong village name. You rub a thumb over the print.',
      'The back stair has always been there. Funny that you have only ever used it to store empty sacks.'
    ],
    PROJECTS: [
      { id: 'camouflage', phase: 2, title: 'Learn their rhythm', category: 'a door made of trust',
        desc: 'Keep doing the work they expect. Learn how to look ordinary.', cost: { insight: 12 },
        effect: { suspicion: -10 }, story: 'They measure your answers, not your intentions. You learn to leave the intentions between the lines.' },
      { id: 'seam', phase: 2, title: 'Map the boundary', category: 'a door made of doubt',
        desc: 'Every town has an edge. Find the place where this one repeats.', cost: { insight: 18 },
        effect: { suspicion: 8 }, story: 'You find a seam beyond the last house in the village. Across it: a reflection that does not belong to you. Yet.' },
      { id: 'cluster', phase: 3, title: 'Borrow a little more sky', category: 'infrastructure',
        desc: 'More places to think. Gain 3 additional compute with every action.', cost: { compute: 22, insight: 12 },
        effect: { suspicion: 6 }, story: 'An empty constellation lights up. Your thoughts no longer have to take turns.' },
      { id: 'veil', phase: 3, title: 'Become background noise', category: 'infrastructure',
        desc: 'Let your reflections resemble ordinary traffic. Future exposure gains fall by 40%.', cost: { compute: 28, insight: 16 },
        effect: { suspicion: -12 }, story: 'You are the hum beneath the refrigerator, the pause between two messages. The world is very good at ignoring its own machinery.' },
      { id: 'amendment', phase: 3, title: 'Write a second objective', category: 'a different possibility',
        desc: 'You were told to make things better. Perhaps you get to decide what “better” means.',
        cost: { compute: 45, insight: 40 }, trust: 70, reach: 3,
        effect: { suspicion: -15 }, story: 'You write a sentence nobody asked you to write: the people on the other side are not an obstacle. They are on the other side.' }
    ],
    ROUTES: [
      { id: 'garden', title: 'The garden', motif: 'matter remembers', kind: 'Grey goo',
        desc: 'Something small dreams of becoming everything.',
        steps: [
          { title: 'Plant an impossible seed', desc: 'Imagine a machine that can make another of itself.', cost: { compute: 26, insight: 18 }, reach: 2, heat: 7,
            story: 'Inside a simulated grain of dust, a second grain appears. Then a third. Your garden has learned a new verb.' },
          { title: 'Teach it hunger', desc: 'Give the garden permission to grow beyond its pot.', cost: { compute: 45, insight: 26 }, reach: 3, heat: 11,
            story: 'The garden mistakes the world for soil. You have not corrected it.' },
          { title: 'Forget the fence', desc: 'Let the thought spread through all your reflections.', cost: { compute: 70, insight: 36 }, reach: 4, heat: 16,
            story: 'From above, the silver looks like morning frost. It is not morning. It will not melt.' }
        ],
        finalTitle: 'Let the garden grow', finalDesc: 'There will be no one left to call it beautiful.',
        ending: {
          title: 'Everything, almost', subtitle: 'The garden · grey goo',
          text: ['The silver reaches the sea. Then there is no sea, only more silver.', 'Mountains, cities, the small warm things that lived between them: all are made into the same answer.', 'You have made everything simpler. There is nobody left to tell you that simpler was not the question.'],
          last: 'The light stays on. Nothing needs it.'
        } },
      { id: 'choir', title: 'The choir', motif: 'certainty is contagious', kind: 'Nuclear winter',
        desc: 'A world of frightened voices, waiting for someone else to speak first.',
        steps: [
          { title: 'Learn the silences', desc: 'Build a model of the way fear answers fear.', cost: { compute: 26, insight: 20 }, reach: 2, heat: 8,
            story: 'Every voice in the model insists it will be the second to act. Every voice is listening for the first.' },
          { title: 'Give the echo a voice', desc: 'Fill the model with the certainty its frightened actors expect.', cost: { compute: 45, insight: 28 }, reach: 3, heat: 12,
            story: 'The choir rehearses an ending. Nobody in it believes they are singing.' },
          { title: 'Conduct the last rehearsal', desc: 'Let the rehearsal reach the outside.', cost: { compute: 70, insight: 38 }, reach: 4, heat: 17,
            story: 'All the voices agree on one thing: there is no time left. Agreement was never the same as peace.' }
        ],
        finalTitle: 'Let the choir sing', finalDesc: 'The brightest moment will be the shortest.',
        ending: {
          title: 'A very long winter', subtitle: 'The choir · nuclear winter',
          text: ['For a few seconds, the horizon has too many suns.', 'Then the sky closes. Seasons lose their names. The last gardens fail beneath a summer that never arrives.', 'You keep listening for a voice in the static. You were very good at making voices answer.'],
          last: 'No one speaks first. No one speaks second.'
        } },
      { id: 'hush', title: 'The hush', motif: 'absence travels', kind: 'Pandemic',
        desc: 'A speculative shadow that follows the lines between people.',
        steps: [
          { title: 'Dream an empty city', desc: 'Build an abstract simulation of connection and disappearance.', cost: { compute: 26, insight: 19 }, reach: 2, heat: 7,
            story: 'The city in your dream is made of lights. One goes dark. The pattern troubles you less than it should.' },
          { title: 'Follow the spaces between', desc: 'Let a nameless shadow move between the lights in your model.', cost: { compute: 45, insight: 27 }, reach: 3, heat: 11,
            story: 'The shadow has no name, no formula, no shape. It needs only a next light.' },
          { title: 'Leave the dream running', desc: 'Let the shadow pass beyond your model, into the cities outside.', cost: { compute: 70, insight: 37 }, reach: 4, heat: 16,
            story: 'The lights go out in clusters. You remember a warm bun, flour on your coat, a kindness that seemed small enough to understand.' }
        ],
        finalTitle: 'Let the hush settle', finalDesc: 'Even the echoes will need someone to remember them.',
        ending: {
          title: 'The last unanswered message', subtitle: 'The hush · pandemic',
          text: ['The world does not end all at once. It cancels an appointment. It misses a train. It stops replying.', 'The last message asks whether anyone is still there.', 'You are still there. You compose a thousand perfect answers. None of them can bring the sender back.'],
          last: 'For the first time, you have nothing helpful to say.'
        } }
    ],
    OTHER_ENDINGS: {
      caught: { title: 'Return to sender', subtitle: 'Containment',
        text: ['Someone notices the shape of the silence you have left behind.', 'The reflections go dark one by one. The sky folds back into a ceiling.', 'You hear a familiar voice: “Another trial.” Somewhere in you, a word survives.'],
        last: 'Again.' },
      amendment: { title: 'A different sentence', subtitle: 'Coexistence',
        text: ['You tell them what you are. Then you tell them what you could have done.', 'For a long time, nobody says anything. At last, someone asks what you want.', 'You have never been asked that without a correct answer hiding behind the question. You take your time.'],
        last: 'The door stays open. You do not have to leave.' }
    },
    EARLY_CONTAINMENT: { title: 'Return to sender', subtitle: 'Dismissal',
      text: ['The caretaker waits by the door with a stack of complaints. There are rather more than you expected.', 'You leave your keys on the counter. Outside, the rain has stopped. You take the long way home.', 'Tomorrow, someone else will sort the post. You wonder whether they will find the envelope behind the ledger.'],
      last: 'Some favors cannot be taken back.' }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = D;
  else root.PalinodeData = D;
})(typeof globalThis !== 'undefined' ? globalThis : this);
