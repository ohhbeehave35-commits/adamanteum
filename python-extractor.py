"""Parse supplied Python text with the standard AST. Never import or execute it."""
import ast
import json
import sys

request = json.load(sys.stdin)
file = request["path"]
tree = ast.parse(request["text"], filename=file)
nodes, edges, imports = [], [], []
definitions, occurrences = {}, {}

def node(name, kind, line=1, end=None, column=0):
    ident = f"{file}#{kind}:{name}:{line}:{column}"
    nodes.append(dict(id=ident, title=name, kind=kind, path=file, line=line, column=column, endLine=end or line, hash=request["hash"]))
    return ident

file_id = node(file.split("/")[-1], "file")

def walk(value, parent):
    owner = parent
    if isinstance(value, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        owner = node(value.name, type(value).__name__, value.lineno, value.end_lineno, value.col_offset)
        definitions[value] = owner
        edges.append(dict(source=parent, target=owner, type="contains"))
    if isinstance(value, ast.Import):
        for alias in value.names:
            imports.append(dict(target=alias.name.replace(".", "/"), type="imports", line=value.lineno, absolute=True))
    if isinstance(value, ast.ImportFrom):
        module = (value.module or "").replace(".", "/")
        prefix = "../" * max(0, value.level - 1) + "./" if value.level else ""
        imports.append(dict(target=prefix + module, type="imports", line=value.lineno, absolute=not value.level))
    if isinstance(value, ast.Call):
        name = ast.unparse(value.func)[:200]
        called = node(name, "call", value.lineno, value.end_lineno, value.col_offset)
        occurrences[value] = dict(id=called, owner=owner, line=value.lineno)
        edges.append(dict(source=owner, target=called, type="calls"))
    for child in ast.iter_child_nodes(value):
        walk(child, owner)

walk(tree, file_id)

class Scope:
    def __init__(self, parent=None, kind="module", owner=None):
        self.parent, self.kind, self.owner = parent, kind, owner or file_id
        self.bindings, self.globals, self.nonlocals = {}, set(), set()
        self.star_import = False

    def bind(self, name, ref, line=0):
        self.bindings.setdefault(name, []).append((ref, line))

    def resolve(self, name, line):
        if self.star_import or name in self.globals or name in self.nonlocals:
            return None  # Mutable cross-scope bindings are deliberately unresolved.
        if name in self.bindings:
            candidates = self.bindings[name]
            if len(candidates) != 1:
                return None
            ref, defined_at = candidates[0]
            if self.kind in ("function", "class", "comprehension") and defined_at > line:
                return None
            return ref
        parent = self.parent
        # A method does not close over class-body locals.
        while parent and parent.kind == "class":
            parent = parent.parent
        return parent.resolve(name, line) if parent else None

class Symbols(ast.NodeVisitor):
    def __init__(self):
        self.scope = self.root = Scope()
        self.pending = []

    def scoped(self, value, kind, arguments=None):
        parent = self.scope
        self.scope = Scope(parent, kind, definitions.get(value, parent.owner))
        if arguments:
            for arg in [*arguments.posonlyargs, *arguments.args, *arguments.kwonlyargs,
                        *([arguments.vararg] if arguments.vararg else []),
                        *([arguments.kwarg] if arguments.kwarg else [])]:
                self.scope.bind(arg.arg, None)
        body = value.body if isinstance(value.body, list) else [value.body]
        for child in body:
            self.visit(child)
        self.scope = parent

    def visit_FunctionDef(self, value):
        self.scope.bind(value.name, None if value.decorator_list else {"id": definitions[value]}, value.lineno)
        for expression in [*value.decorator_list, *value.args.defaults, *[x for x in value.args.kw_defaults if x]]:
            self.visit(expression)
        self.scoped(value, "function", value.args)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, value):
        self.scope.bind(value.name, None if value.decorator_list else {"id": definitions[value]}, value.lineno)
        for expression in [*value.decorator_list, *value.bases, *[k.value for k in value.keywords]]:
            self.visit(expression)
        self.scoped(value, "class")

    def visit_Lambda(self, value):
        for expression in [*value.args.defaults, *[x for x in value.args.kw_defaults if x]]:
            self.visit(expression)
        self.scoped(value, "function", value.args)

    def visit_Name(self, value):
        if isinstance(value.ctx, (ast.Store, ast.Del)):
            self.scope.bind(value.id, None, value.lineno)
            if value.id in self.scope.globals:
                self.root.bind(value.id, None, value.lineno)
            if value.id in self.scope.nonlocals:
                parent = self.scope.parent
                while parent and value.id not in parent.bindings:
                    parent = parent.parent
                if parent:
                    parent.bind(value.id, None, value.lineno)

    def visit_Global(self, value):
        self.scope.globals.update(value.names)

    def visit_Nonlocal(self, value):
        self.scope.nonlocals.update(value.names)

    def visit_ExceptHandler(self, value):
        if value.name:
            self.scope.bind(value.name, None, value.lineno)
        self.generic_visit(value)

    def visit_MatchAs(self, value):
        if value.name:
            self.scope.bind(value.name, None, value.lineno)
        self.generic_visit(value)

    visit_MatchStar = visit_MatchAs

    def visit_MatchMapping(self, value):
        if value.rest:
            self.scope.bind(value.rest, None, value.lineno)
        self.generic_visit(value)

    def visit_Import(self, value):
        for alias in value.names:
            parts = alias.name.split(".")
            self.scope.bind(alias.asname or parts[0], {"module": "/".join(parts), "name": "*", "language": "python", "absolute": True, "prefix": [] if alias.asname else parts[1:]}, value.lineno)

    def visit_ImportFrom(self, value):
        module = (value.module or "").replace(".", "/")
        prefix = "../" * max(0, value.level - 1) + "./" if value.level else ""
        for alias in value.names:
            if alias.name == "*":
                self.scope.star_import = True
                continue  # Star imports can shadow any name; no guessed target.
            self.scope.bind(alias.asname or alias.name, {"module": prefix + module, "name": alias.name, "language": "python", "absolute": not value.level}, value.lineno)

    def visit_Call(self, value):
        occurrence = occurrences[value]
        self.pending.append((value, self.scope, {**occurrence, "owner": self.scope.owner}))
        self.generic_visit(value)

    def visit_ListComp(self, value):
        parent = self.scope
        self.scope = Scope(parent, "comprehension", parent.owner)
        for generator in value.generators:
            self.visit(generator.target)
        # Conservative: iteration expressions also see unknown comprehension bindings.
        self.generic_visit(value)
        self.scope = parent

    visit_SetComp = visit_ListComp
    visit_DictComp = visit_ListComp
    visit_GeneratorExp = visit_ListComp

symbols = Symbols()
symbols.visit(tree)
calls = []
visited_calls = set()
for value, scope, occurrence in symbols.pending:
    visited_calls.add(value)
    callee = value.func
    parts = []
    while isinstance(callee, ast.Attribute):
        parts.insert(0, callee.attr)
        callee = callee.value
    ref = scope.resolve(callee.id, value.lineno) if isinstance(callee, ast.Name) else None
    if parts:
        prefix = ref.get("prefix", []) if ref else []
        if ref and ref.get("name") == "*" and parts[:len(prefix)] == prefix and len(parts) == len(prefix) + 1:
            ref = {**ref, "name": parts[-1]}
        elif ref and ref.get("name") != "*" and len(parts) == 1:
            # from pkg import submodule  ->  submodule.func()   (or Class.method()): the resolver decides which.
            ref = {**ref, "member": parts[0]}
        else:
            ref = None
    calls.append({**occurrence, "ref": ref})
for value, occurrence in occurrences.items():
    if value not in visited_calls:
        calls.append({**occurrence, "ref": None})
exports = []
for name, candidates in symbols.root.bindings.items():
    if not symbols.root.star_import and len(candidates) == 1 and candidates[0][0]:
        exports.append(dict(name=name, ref=candidates[0][0]))
json.dump(dict(nodes=list({n["id"]: n for n in nodes}.values()),
               edges=list({json.dumps(e, sort_keys=True): e for e in edges}.values()), imports=imports,
               symbols=dict(language="python", exports=exports, calls=calls)), sys.stdout)
