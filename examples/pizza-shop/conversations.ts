// Scripted orders for `bun run pizza:check`: what the customer sets out to say, and the lines the
// order should end with. The script plays the customer: it says its `moves` in turn, and answers
// the agent's questions from the gold order (yes when the register matches it, a correction when it
// doesn't, the phone number, and so on). So a case passes only if the order is right when the
// customer agrees to it. `hard` marks cases we know the design doesn't handle yet; they're reported
// but don't count.

export interface Conversation {
  name: string;
  /** What the customer says, in order, when the agent is listening. */
  moves: string[];
  /** The order's lines at the end, as read back (in any order). */
  lines: string[];
  /** Whether the order was placed. Default true. */
  placed?: boolean;
  /** The customer turns the final read-back down. */
  declines?: boolean;
  hard?: boolean;
}

export const conversations: Conversation[] = [
  // Adds
  { name: "one pizza", moves: ["a large pepperoni pizza, that's all"], lines: ["1 large pizza with pepperoni"] },
  { name: "pizza and a drink", moves: ["two large pepperoni pizzas and a diet coke"], lines: ["2 large pizzas with pepperoni", "1 diet coke"] },
  { name: "greeting first", moves: ["hi there", "can I get a medium mushroom pizza"], lines: ["1 medium pizza with mushrooms"] },
  { name: "three items", moves: ["a small cheese pizza, a large sausage pizza and two sprites"], lines: ["1 small pizza with cheese", "1 large pizza with sausage", "2 sprites"] },
  { name: "adds over turns", moves: ["a large pizza with ham and pineapple", "and a lemonade", "and a bottled water"], lines: ["1 large pizza with ham and pineapple", "1 lemonade", "1 water"] },
  { name: "extra and no", moves: ["medium pizza with extra cheese and no onions"], lines: ["1 medium pizza with extra cheese and no onions"] },
  { name: "style", moves: ["a large thin crust pepperoni"], lines: ["1 large thin crust pizza with pepperoni"] },
  { name: "2 liter", moves: ["a 2 liter coke and a large pepperoni pizza"], lines: ["1 coke, 2 liter", "1 large pizza with pepperoni"] },
  { name: "same item twice", moves: ["a large pepperoni pizza", "and another large pepperoni pizza"], lines: ["1 large pizza with pepperoni", "1 large pizza with pepperoni"] },
  { name: "numbers as words", moves: ["three medium pizzas with bacon and two cans of coke"], lines: ["3 medium pizzas with bacon", "2 cokes, in cans"] },

  // Changes
  { name: "change size", moves: ["a large pepperoni pizza", "actually make that a medium"], lines: ["1 medium pizza with pepperoni"] },
  { name: "add a topping", moves: ["a large cheese pizza and a coke", "can you put mushrooms on the pizza"], lines: ["1 large pizza with cheese and mushrooms", "1 coke"] },
  { name: "take off a topping", moves: ["a large pizza with pepperoni and onions", "no onions on that"], lines: ["1 large pizza with pepperoni and no onions"] },
  { name: "change the drink", moves: ["a medium pepperoni pizza and a coke", "make the coke a diet coke"], lines: ["1 medium pizza with pepperoni", "1 diet coke"] },
  { name: "change by position", moves: ["a small cheese pizza and a large cheese pizza", "make the first one a medium"], lines: ["1 medium pizza with cheese", "1 large pizza with cheese"] },
  { name: "change the number", moves: ["a large pepperoni pizza", "make that two"], lines: ["2 large pizzas with pepperoni"] },
  { name: "change and add in one message", moves: ["a large pepperoni pizza", "make that a small, and add a sprite"], lines: ["1 small pizza with pepperoni", "1 sprite"] },
  { name: "split a line", moves: ["two large pepperoni pizzas", "make one of them a medium"], lines: ["1 large pizza with pepperoni", "1 medium pizza with pepperoni"] },
  { name: "two changes to one line", moves: ["a small cheese pizza", "make it a large with pepperoni and no cheese"], lines: ["1 large pizza with pepperoni and no cheese"] },

  // Removals
  { name: "remove a drink", moves: ["a large pepperoni pizza and a coke", "actually no coke"], lines: ["1 large pizza with pepperoni"] },
  { name: "remove by name", moves: ["a medium sausage pizza, a medium cheese pizza and a water", "take off the cheese pizza"], lines: ["1 medium pizza with sausage", "1 water"] },
  { name: "remove then add", moves: ["two sprites", "scratch the sprites, make it two lemonades"], lines: ["2 lemonades"] },
  { name: "remove everything, then order", moves: ["a large pepperoni pizza", "forget the pizza", "a medium mushroom pizza instead"], lines: ["1 medium pizza with mushrooms"] },

  // Finishing
  { name: "done in the first message", moves: ["just a large pepperoni pizza please, that's it"], lines: ["1 large pizza with pepperoni"] },
  { name: "finished with an item", moves: ["two medium pizzas", "and a water, that's all"], lines: ["2 medium pizzas", "1 water"] },
  { name: "phone with the done", moves: ["a large pepperoni pizza", "that's all, my number is 479-555-0100"], lines: ["1 large pizza with pepperoni"] },
  { name: "doesn't confirm", moves: ["a large pepperoni pizza"], lines: ["1 large pizza with pepperoni"], declines: true, placed: false },

  // Asides and noise
  { name: "hours, then an order", moves: ["what time do you close?", "a large pepperoni pizza"], lines: ["1 large pizza with pepperoni"] },
  { name: "the menu, then an order", moves: ["what's on the menu?", "a medium mushroom pizza and a sprite"], lines: ["1 medium pizza with mushrooms", "1 sprite"] },
  { name: "the menu, mid-order", moves: ["a large pepperoni pizza", "what drinks do you have?", "a lemonade"], lines: ["1 large pizza with pepperoni", "1 lemonade"] },
  { name: "hours, mid-order", moves: ["a coke", "how late are you open?", "and a small cheese pizza"], lines: ["1 coke", "1 small pizza with cheese"] },
  { name: "a question about the menu", moves: ["what sizes do you have?", "a large pepperoni then"], lines: ["1 large pizza with pepperoni"] },
  { name: "crusts, then an order", moves: ["what kinds of pizza crust do you have?", "a medium thin crust pepperoni"], lines: ["1 medium thin crust pizza with pepperoni"] },
  { name: "not on the menu", moves: ["do you have breadsticks?", "ok, a large cheese pizza then"], lines: ["1 large pizza with cheese"] },
  { name: "a topping question mid-order", moves: ["a large pepperoni pizza", "do you have jalapenos?", "put jalapenos on it"], lines: ["1 large pizza with pepperoni and jalapenos"] },
  { name: "small talk then order", moves: ["hey how's it going", "a large pepperoni pizza please"], lines: ["1 large pizza with pepperoni"] },
  { name: "unrelated", moves: ["is the parking lot free?", "a large pepperoni pizza please"], lines: ["1 large pizza with pepperoni"] },
];
