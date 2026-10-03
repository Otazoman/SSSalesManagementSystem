import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, type DataTableColumn } from "./DataTable";

interface Row {
  code: string;
  name: string;
}

const columns: DataTableColumn[] = [
  { key: "code", label: "コード" },
  { key: "name", label: "名称" },
];

describe("DataTable", () => {
  it("列見出しを表示する", () => {
    render(
      <DataTable<Row>
        columns={columns}
        data={[]}
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    expect(screen.getByText("コード")).toBeInTheDocument();
    expect(screen.getByText("名称")).toBeInTheDocument();
  });

  it("loading:trueの間は読み込み中行のみ表示し、renderRowは呼ばない", () => {
    render(
      <DataTable<Row>
        columns={columns}
        data={[{ code: "PCS", name: "個" }]}
        loading
        renderRow={(row) => (
          <tr key={row.code}>
            <td>{row.name}</td>
          </tr>
        )}
      />,
    );
    expect(screen.getByText("読み込み中...")).toBeInTheDocument();
    expect(screen.queryByText("個")).not.toBeInTheDocument();
  });

  it("dataが空の場合はemptyMessageを表示する", () => {
    render(
      <DataTable<Row>
        columns={columns}
        data={[]}
        emptyMessage="該当するデータはありません"
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    expect(
      screen.getByText("該当するデータはありません"),
    ).toBeInTheDocument();
  });

  it("dataがある場合は各要素に対しrenderRowを呼ぶ", () => {
    const data: Row[] = [
      { code: "PCS", name: "個" },
      { code: "KG", name: "キログラム" },
    ];
    render(
      <DataTable<Row>
        columns={columns}
        data={data}
        renderRow={(row) => (
          <tr key={row.code}>
            <td>{row.code}</td>
            <td>{row.name}</td>
          </tr>
        )}
      />,
    );
    expect(screen.getByText("PCS")).toBeInTheDocument();
    expect(screen.getByText("キログラム")).toBeInTheDocument();
  });

  it("sortable:trueの列見出しクリックでonSortChangeをそのcolumn.keyで呼ぶ", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable<Row>
        columns={[
          { key: "code", label: "コード", sortable: true },
          { key: "name", label: "名称" },
        ]}
        data={[]}
        onSortChange={onSortChange}
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    await userEvent.click(screen.getByText("コード"));
    expect(onSortChange).toHaveBeenCalledWith("code", false);
  });

  it("追加要望J-1-a: Shift+クリックの場合はonSortChangeの第2引数にtrueを渡す", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable<Row>
        columns={[
          { key: "code", label: "コード", sortable: true },
          { key: "name", label: "名称" },
        ]}
        data={[]}
        onSortChange={onSortChange}
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    fireEvent.click(screen.getByText("コード"), { shiftKey: true });
    expect(onSortChange).toHaveBeenCalledWith("code", true);
  });

  it("追加要望J-1-a: sortKeysを渡すと複数キーそれぞれに優先順位番号と矢印を表示する", () => {
    render(
      <DataTable<Row>
        columns={[
          { key: "code", label: "コード", sortable: true },
          { key: "name", label: "名称", sortable: true },
        ]}
        data={[]}
        sortKeys={[
          { key: "name", direction: "desc" },
          { key: "code", direction: "asc" },
        ]}
        onSortChange={vi.fn()}
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    expect(screen.getByText("1▼")).toBeInTheDocument();
    expect(screen.getByText("2▲")).toBeInTheDocument();
  });

  it("sortable:trueでない列見出しをクリックしてもonSortChangeを呼ばない", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable<Row>
        columns={[{ key: "code", label: "コード" }]}
        data={[]}
        onSortChange={onSortChange}
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    await userEvent.click(screen.getByText("コード"));
    expect(onSortChange).not.toHaveBeenCalled();
  });

  it("現在のソート列には昇順/降順の矢印を表示する", () => {
    const { rerender } = render(
      <DataTable<Row>
        columns={[{ key: "code", label: "コード", sortable: true }]}
        data={[]}
        sortBy="code"
        sortDirection="asc"
        onSortChange={vi.fn()}
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    expect(screen.getByText("▲")).toBeInTheDocument();

    rerender(
      <DataTable<Row>
        columns={[{ key: "code", label: "コード", sortable: true }]}
        data={[]}
        sortBy="code"
        sortDirection="desc"
        onSortChange={vi.fn()}
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    expect(screen.getByText("▼")).toBeInTheDocument();
  });

  it("minWidth: 既定は500px、指定するとその幅を表の最小幅にする(狭い画面では枠内で横スクロール)", () => {
    const { container, rerender } = render(
      <DataTable<Row>
        columns={columns}
        data={[]}
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    const inner = () =>
      container.querySelector("table")!.parentElement as HTMLElement;
    expect(inner().style.minWidth).toBe("500px");
    expect((inner().parentElement as HTMLElement).className).toContain(
      "overflow-x-auto",
    );
    rerender(
      <DataTable<Row>
        columns={columns}
        data={[]}
        minWidth={900}
        renderRow={(row) => <tr key={row.code} />}
      />,
    );
    expect(inner().style.minWidth).toBe("900px");
  });
});
