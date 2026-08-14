const std = @import("std");
const builtin = @import("builtin");

const SupportedTarget = struct {
    zig_target: []const u8,
    output_name: []const u8,
};

// Keep this matrix aligned with OpenTUI's published native packages.
const supported_targets = [_]SupportedTarget{
    .{ .zig_target = "x86_64-linux-gnu.2.17", .output_name = "x86_64-linux" },
    .{ .zig_target = "aarch64-linux-gnu.2.17", .output_name = "aarch64-linux" },
    .{ .zig_target = "x86_64-linux-musl", .output_name = "x86_64-linux-musl" },
    .{ .zig_target = "aarch64-linux-musl", .output_name = "aarch64-linux-musl" },
    .{ .zig_target = "x86_64-macos.13.0", .output_name = "x86_64-macos" },
    .{ .zig_target = "aarch64-macos.13.0", .output_name = "aarch64-macos" },
    .{ .zig_target = "x86_64-windows-gnu", .output_name = "x86_64-windows" },
    .{ .zig_target = "aarch64-windows-gnu", .output_name = "aarch64-windows" },
};

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const target_option = b.option([]const u8, "target", "Build one supported Zig target");
    const build_all = b.option(bool, "all", "Build all published native targets") orelse false;
    addTests(b, optimize) catch @panic("failed to configure native tests");

    if (target_option != null and build_all) {
        std.debug.print("-Dtarget and -Dall cannot be used together\n", .{});
        std.process.exit(1);
    }

    if (target_option) |target_name| {
        for (supported_targets) |target| {
            if (std.mem.eql(u8, target.zig_target, target_name)) {
                addLibrary(b, target, optimize) catch @panic("failed to configure native target");
                return;
            }
        }
        std.debug.print("unsupported native target: {s}\n", .{target_name});
        std.process.exit(1);
    }

    if (build_all) {
        for (supported_targets) |target| {
            addLibrary(b, target, optimize) catch @panic("failed to configure native target");
        }
        return;
    }

    const host_arch = @tagName(builtin.cpu.arch);
    const host_os = @tagName(builtin.os.tag);
    for (supported_targets) |target| {
        if (std.mem.find(u8, target.zig_target, host_arch) != null and
            std.mem.find(u8, target.zig_target, host_os) != null and
            std.mem.find(u8, target.zig_target, "musl") == null)
        {
            addLibrary(b, target, optimize) catch @panic("failed to configure host target");
            return;
        }
    }

    std.debug.print("unsupported host: {s}-{s}\n", .{ host_arch, host_os });
    std.process.exit(1);
}

fn addTests(b: *std.Build, optimize: std.builtin.OptimizeMode) !void {
    const test_target = if (builtin.os.tag == .linux)
        try std.Target.Query.parse(.{ .arch_os_abi = try std.fmt.allocPrint(b.allocator, "{s}-linux-musl", .{@tagName(builtin.cpu.arch)}) })
    else
        std.Target.Query{};
    const target = b.resolveTargetQuery(test_target);
    const module = nativeModule(b, target, optimize);
    const tests = b.addTest(.{ .root_module = module });
    const run_tests = b.addRunArtifact(tests);
    b.step("test", "Run native renderer tests").dependOn(&run_tests.step);
}

fn addLibrary(
    b: *std.Build,
    supported_target: SupportedTarget,
    optimize: std.builtin.OptimizeMode,
) !void {
    const query = try std.Target.Query.parse(.{ .arch_os_abi = supported_target.zig_target });
    const target = b.resolveTargetQuery(query);
    const module = nativeModule(b, target, optimize);

    const library = b.addLibrary(.{
        .name = "tex_renderer",
        .linkage = .dynamic,
        .root_module = module,
    });
    const install = b.addInstallArtifact(library, .{
        .dest_dir = .{ .override = .{
            .custom = try std.fmt.allocPrint(b.allocator, "lib/{s}", .{supported_target.output_name}),
        } },
    });
    b.getInstallStep().dependOn(&install.step);
}

fn nativeModule(b: *std.Build, target: std.Build.ResolvedTarget, optimize: std.builtin.OptimizeMode) *std.Build.Module {
    const zigtex = b.dependency("zigtex", .{ .target = target, .optimize = optimize });
    const module = b.createModule(.{
        .root_source_file = b.path("native/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    module.addImport("zigtex", zigtex.module("zigtex"));
    module.addIncludePath(b.path("native/vendor"));
    module.addCSourceFile(.{ .file = b.path("native/nanosvg.c"), .flags = &.{"-std=c99"} });
    module.link_libc = true;
    return module;
}
