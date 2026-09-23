const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LIMITS, validateAndNormalize } = require("../session-upload");

const templatePath = path.join(__dirname, "..", "data", "jeopardy-session-template.json");

test("the downloadable template satisfies the runtime upload contract", () => {
  const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
  const result = validateAndNormalize(template);

  assert.equal(result.valid, true);
  assert.equal(result.board.categories.length, 6);
  assert.equal(result.board.clues.length, 30);
  assert.equal(result.board.dailyDoubleClueId, "custom-category-0-question-2");
});

test("normalizes trimmed content, row values, unknown properties, and an omitted title", () => {
  const session = validSession();
  delete session.title;
  session.ignored = "allowed";
  session.categories[0].title = "  Category 1  ";
  session.categories[0].questions[0].question = "  First question  ";
  session.categories[0].questions[0].answer = "  First answer  ";
  session.categories[0].questions[0].ignored = true;

  const result = validateAndNormalize(session);

  assert.equal(result.valid, true);
  assert.equal(result.board.episodeTitle, "Custom Session");
  assert.equal(result.board.categories[0].title, "Category 1");
  assert.equal(result.board.clues[0].clueText, "First question");
  assert.equal(result.board.clues[0].response, "First answer");
  assert.deepEqual(
    result.board.clues.slice(0, 5).map((clue) => [clue.value, clue.numericValue]),
    [["$200", 200], ["$400", 400], ["$600", 600], ["$800", 800], ["$1,000", 1000]]
  );
});

test("the JSON Schema dimensions and text limits match the runtime contract", () => {
  const schema = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "jeopardy-session.schema.json"),
    "utf8"
  ));

  assert.equal(schema.properties.categories.minItems, LIMITS.categories);
  assert.equal(schema.properties.categories.maxItems, LIMITS.categories);
  assert.equal(schema.$defs.category.properties.questions.minItems, LIMITS.questionsPerCategory);
  assert.equal(schema.$defs.category.properties.questions.maxItems, LIMITS.questionsPerCategory);
  assert.equal(schema.$defs.sessionTitle.maxLength, LIMITS.titleCharacters);
  assert.equal(schema.$defs.categoryTitle.maxLength, LIMITS.categoryTitleCharacters);
  assert.equal(schema.$defs.questionText.maxLength, LIMITS.questionCharacters);
  assert.equal(schema.$defs.answerText.maxLength, LIMITS.answerCharacters);
  assert.equal(schema.additionalProperties, true);
  assert.equal(schema.$defs.category.additionalProperties, true);
  assert.equal(schema.$defs.question.additionalProperties, true);
});

test("uses the last true Daily Double marker and permits no Daily Double", () => {
  const session = validSession();
  session.categories[0].questions[4].dailyDouble = true;
  session.categories[5].questions[3].dailyDouble = true;

  let result = validateAndNormalize(session);
  assert.equal(result.valid, true);
  assert.equal(result.board.dailyDoubleClueId, "custom-category-5-question-3");

  delete session.categories[0].questions[4].dailyDouble;
  delete session.categories[5].questions[3].dailyDouble;
  result = validateAndNormalize(session);
  assert.equal(result.valid, true);
  assert.equal(result.board.dailyDoubleClueId, null);
});

test("reports every reachable schema problem", () => {
  const session = validSession();
  session.title = " ";
  session.categories.pop();
  session.categories[0].title = 42;
  session.categories[0].questions.pop();
  session.categories[1].questions[0].question = "\u0001bad";
  session.categories[1].questions[0].answer = "x".repeat(LIMITS.answerCharacters + 1);
  session.categories[2].questions[0].dailyDouble = "true";

  const result = validateAndNormalize(session);

  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.errors.map((item) => item.code)),
    new Set([
      "text.empty",
      "categories.length",
      "text.type",
      "questions.length",
      "text.control",
      "text.length",
      "dailyDouble.type"
    ])
  );
});

test("enforces exact arrays, strict value types, and character limits", () => {
  const nonObject = validateAndNormalize([]);
  assert.equal(nonObject.valid, false);
  assert.equal(nonObject.errors[0].code, "document.type");

  const session = validSession();
  session.categories[0].questions = null;
  session.categories[1].questions[0].question = false;
  session.categories[1].questions[0].answer = " ";
  session.categories[2].title = "x".repeat(LIMITS.categoryTitleCharacters + 1);

  const result = validateAndNormalize(session);
  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.errors.map((item) => item.code)),
    new Set(["questions.type", "text.type", "text.empty", "text.length"])
  );
});

function validSession() {
  return {
    title: "Valid session",
    categories: Array.from({ length: 6 }, (_, categoryIndex) => ({
      title: `Category ${categoryIndex + 1}`,
      questions: Array.from({ length: 5 }, (_, questionIndex) => ({
        question: `Question ${categoryIndex + 1}-${questionIndex + 1}`,
        answer: `Answer ${categoryIndex + 1}-${questionIndex + 1}`
      }))
    }))
  };
}
